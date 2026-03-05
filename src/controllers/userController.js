const User = require('../models/User');
const File = require('../models/File');
const Folder = require('../models/Folder');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { cloudinary, deleteFromCloudinary } = require('../config/storage');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

function calculateDistance(des1, des2) {
    return Math.sqrt(
        des1.reduce((sum, val, i) => sum + Math.pow(val - des2[i], 2), 0)
    );
}

exports.register = async (req, res) => {
    try {
        const { fname, username, email, password } = req.body;
        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: "Email hoặc tên đăng nhập đã tồn tại." });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            fname,
            username,
            email,
            password: hashedPassword
        });

        res.status(201).json({
            _id: user._id,
            username: user.username,
            token: generateToken(user._id)
        });
    } catch (error) {
        res.status(500).json({ message: "Lỗi đăng ký.", error: error.message });
    }
};

// 1. Hàm Đăng ký/Thêm mẫu gương mặt (Dành cho User đã đăng nhập)
// 1. Hàm Đăng ký/Thêm mẫu gương mặt (Giới hạn tối đa 10 mẫu)
exports.registerFace = async (req, res) => {
    try {
        const { username, descriptor } = req.body;
        const THRESHOLD = 0.55;
        const MAX_FACES = 5; // Giới hạn 5 mẫu

        // 1. Tìm user hiện tại để kiểm tra số lượng mẫu đã có
        const currentUser = await User.findOne({ username });
        if (!currentUser) return res.status(404).json({ message: "Không tìm thấy người dùng" });

        if (currentUser.faceDescriptors && currentUser.faceDescriptors.length >= MAX_FACES) {
            return res.status(400).json({ 
                message: `Bạn đã đạt giới hạn tối đa ${MAX_FACES} mẫu gương mặt. Vui lòng xóa bớt trước khi thêm mới.` 
            });
        }

        // 2. KIỂM TRA TRÙNG LẶP: Gương mặt này đã thuộc về user khác chưa?
        const allOtherUsers = await User.find({ 
            username: { $ne: username }, 
            faceDescriptors: { $exists: true, $not: { $size: 0 } } 
        });

        for (const user of allOtherUsers) {
            for (const savedDescriptor of user.faceDescriptors) {
                const distance = calculateDistance(descriptor, savedDescriptor);
                if (distance < THRESHOLD) {
                    return res.status(400).json({ 
                        message: "Gương mặt này đã được đăng ký bởi một tài khoản khác." 
                    });
                }
            }
        }

        // 3. Tiến hành thêm mẫu mới nếu thỏa mãn các điều kiện
        const updatedUser = await User.findOneAndUpdate(
            { username },
            { $push: { faceDescriptors: descriptor } },
            { new: true }
        );

        res.status(200).json({ 
            message: "Đã lưu mẫu gương mặt thành công", 
            count: updatedUser.faceDescriptors.length,
            remaining: MAX_FACES - updatedUser.faceDescriptors.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.loginWithFace = async (req, res) => {
    try {
        const { descriptor } = req.body; // Chỉ nhận descriptor từ FE
        const THRESHOLD = 0.6;

        // 1. Lấy tất cả user có đăng ký FaceID
        const users = await User.find({ faceDescriptors: { $exists: true, $not: { $size: 0 } } });

        let matchedUser = null;

        // 2. Duyệt qua từng user để tìm người khớp nhất
        for (const user of users) {
            for (const savedDescriptor of user.faceDescriptors) {
                const distance = calculateDistance(descriptor, savedDescriptor);
                if (distance < THRESHOLD) {
                    matchedUser = user;
                    break; 
                }
            }
            if (matchedUser) break;
        }

        if (matchedUser) {
            const token = generateToken(matchedUser._id);
            res.status(200).json({
                _id: matchedUser._id,
                username: matchedUser.username,
                token: token
            });
        } else {
            res.status(401).json({ message: "Không nhận diện được người dùng này." });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (user && (await bcrypt.compare(password, user.password))) {
            res.json({
                _id: user._id,
                fname: user.fname,
                username: user.username,
                email: user.email,
                usedStorage: user.usedStorage,
                storageLimit: user.storageLimit,
                token: generateToken(user._id)
            });
        } else {
            res.status(401).json({ message: "Email hoặc mật khẩu không đúng." });
        }
    } catch (error) {
        res.status(500).json({ message: "Lỗi đăng nhập." });
    }
};

exports.getMe = async (req, res) => {
    res.json(req.user);
};

exports.updateProfile = async (req, res) => {
    try {
        const { id } = req.query; 
        const isAdmin = req.user.role === 'admin';
        const targetUserId = (isAdmin && id) ? id : req.user._id;
        const user = await User.findById(targetUserId);
        if (!user) return res.status(404).json({ message: "Người dùng không tồn tại." });
        if (req.body.username || req.body.email) {
            const userExists = await User.findOne({
                _id: { $ne: targetUserId },
                $or: [
                    { username: req.body.username || "" },
                    { email: req.body.email || "" }
                ]
            });
            if (userExists) {
                return res.status(400).json({ message: "Username hoặc Email đã tồn tại." });
            }
        }
        const updates = {};
        const allowedFields = isAdmin 
            ? ['fname', 'username', 'email', 'role', 'storageLimit', 'status']
            : ['fname', 'username', 'email'];
        Object.keys(req.body).forEach(key => {
            if (allowedFields.includes(key) && req.body[key] !== undefined) {
                updates[key] = req.body[key];
            }
        });

        if (req.files) {
            if (req.files.avatar) {
                if (user.avatar) await deleteFromCloudinary(user.avatar);
                updates.avatar = req.files.avatar[0].path;
            }
            if (req.files.cover) {
                if (user.cover) await deleteFromCloudinary(user.cover);
                updates.cover = req.files.cover[0].path;
            }
        }

        if (req.body.password) {
            const salt = await bcrypt.genSalt(10);
            updates.password = await bcrypt.hash(req.body.password, salt);
        }

        const updatedUser = await User.findByIdAndUpdate(
            targetUserId, 
            { $set: updates }, 
            { new: true, runValidators: true } 
        ).select("-password");

        res.json({
            message: "Cập nhật thông tin thành công.",
            user: updatedUser
        });

    } catch (error) {
        res.status(500).json({ message: "Lỗi cập nhật.", error: error.message });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Bạn không có quyền truy cập danh sách này." });
        }
        const users = await User.find().select("-password").sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi lấy danh sách người dùng." });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        const requester = req.user;
        const targetUser = await User.findById(id);
        if (!targetUser) {
            return res.status(404).json({ message: "Người dùng không tồn tại." });
        }

        const isDeletingSelf = requester._id.toString() === id;
        const isAdmin = requester.role === 'admin';

        if (!isDeletingSelf) {
            if (!isAdmin) {
                return res.status(403).json({ message: "Bạn không có quyền thực hiện hành động này." });
            }
            if (targetUser.role === 'admin') {
                return res.status(403).json({ message: "Bạn không thể xóa một tài khoản Quản trị viên khác." });
            }
        }

        if (targetUser.avatar) {
            await deleteFromCloudinary(targetUser.avatar);
        }
        if (targetUser.cover) {
            await deleteFromCloudinary(targetUser.cover);
        }

        const userFiles = await File.find({ userId: id });
        
        if (userFiles.length > 0) {
            const publicIds = userFiles.map(file => file.cloudinaryId);
            await Promise.all(publicIds.map(publicId => 
                cloudinary.uploader.destroy(publicId)
            ));
        }

        await File.deleteMany({ userId: id });
        await Folder.deleteMany({ userId: id });
        await User.findByIdAndDelete(id);
        const successMessage = isDeletingSelf 
            ? "Tài khoản của bạn và toàn bộ dữ liệu đã được xóa thành công."
            : `Admin đã xóa thành công người dùng ${targetUser.username} và toàn bộ dữ liệu liên quan.`;

        return res.json({ message: successMessage });

    } catch (error) {
        res.status(500).json({ message: "Lỗi hệ thống khi xóa người dùng.", error: error.message });
    }
};

exports.getStorageStats = async (req, res) => {
    try {
        const userId = req.user._id;

        // 1. Lấy thông tin dung lượng từ User
        const user = await User.findById(userId).select('storageLimit usedStorage');
        if (!user) {
            return res.status(404).json({ message: "User không tồn tại" });
        }

        // 2. Thống kê tổng hợp bằng Promise.all để chạy song song
        const [totalPhotos, totalFolders, rootFilesCount] = await Promise.all([
            // Đếm tất cả ảnh (dựa trên mimeType bắt đầu bằng 'image/')
            File.countDocuments({ 
                userId, 
                isDeleted: false, 
                mimeType: /^image\// 
            }),

            // Đếm tất cả thư mục
            Folder.countDocuments({ 
                userId, 
                isDeleted: false 
            }),

            // Đếm số lượng tập tin ở thư mục gốc (folderId là null)
            File.countDocuments({ 
                userId, 
                folderId: null, 
                isDeleted: false 
            })
        ]);

        // 3. Tính toán dung lượng còn trống
        const remainingStorage = user.storageLimit - user.usedStorage;

        return res.status(200).json({
            success: true,
            data: {
                counts: {
                    photos: totalPhotos,
                    folders: totalFolders,
                    rootFiles: rootFilesCount
                },
                storage: {
                    total: user.storageLimit,
                    used: user.usedStorage,
                    remaining: Math.max(0, remainingStorage), // Tránh số âm
                    usedPercentage: ((user.usedStorage / user.storageLimit) * 100).toFixed(2) + '%'
                }
            }
        });

    } catch (error) {
        console.error("Stats Error:", error);
        res.status(500).json({ message: "Lỗi hệ thống khi lấy thống kê" });
    }
};

// 1. Đếm số lượng mẫu gương mặt hiện có
exports.countFaceDescriptors = async (req, res) => {
    try {
        // Lấy username từ body hoặc từ token (req.user) tùy vào cách bạn thiết lập route
        const username = req.body.username || req.user.username;

        const user = await User.findOne({ username }).select('faceDescriptors');
        
        if (!user) {
            return res.status(404).json({ message: "Không tìm thấy người dùng." });
        }

        const count = user.faceDescriptors ? user.faceDescriptors.length : 0;
        const MAX_FACES = 10;

        res.status(200).json({
            success: true,
            count: count,
            limit: MAX_FACES,
            canAddMore: count < MAX_FACES
        });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi đếm mẫu gương mặt.", error: error.message });
    }
};

// 2. Xóa tất cả mẫu gương mặt
// Xóa tất cả mẫu gương mặt dựa trên ID người dùng
exports.clearFaceDescriptors = async (req, res) => {
    try {
        const userId = req.user._id; 

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: { faceDescriptors: [] } },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: "Không tìm thấy người dùng." 
            });
        }

        res.status(200).json({
            success: true,
            message: "Đã xóa tất cả mẫu gương mặt thành công."
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Lỗi khi xóa mẫu gương mặt.", 
            error: error.message 
        });
    }
};

