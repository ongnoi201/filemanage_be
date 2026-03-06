const File = require('../models/File');
const User = require('../models/User');
const { deleteMultipleFromCloudinary } = require('../config/storage');
const Folder = require('../models/Folder');

// 1. Upload nhiều file
exports.uploadFiles = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "Vui lòng chọn ít nhất một file." });
        }

        let totalSize = 0;

        const fileDocs = req.files.map(file => {
            totalSize += file.size;

            return {
                name: file.originalname,
                originalName: file.originalname,
                type: 'file',
                extension: file.originalname.split('.').pop(),
                mimeType: file.mimetype,
                size: file.size,
                url: file.path,
                cloudinaryId: file.filename, // đây là public_id
                folderId: req.body.folderId || null,
                userId: req.user._id
            };
        });

        const savedFiles = await File.insertMany(fileDocs);

        await User.findByIdAndUpdate(req.user._id, {
            $inc: { usedStorage: totalSize }
        });

        res.status(201).json(savedFiles);

    } catch (error) {
        console.error('Chi tiết lỗi upload:', error); // In ra console để debug
        res.status(500).json({
            message: "Lỗi server khi upload file",
            error: error.message
        });
    }
};

exports.renameFile = async (req, res) => {
    try {
        const { name } = req.body;
        const file = await File.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { name: name },
            { new: true }
        );
        if (!file) return res.status(404).json({ message: "Không tìm thấy file." });
        res.json(file);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi đổi tên." });
    }
};

const getChildItems = async (folderId, userId) => {
    let allFiles = [];
    let allFolders = [folderId];

    // 1. Tìm tất cả file trực tiếp trong thư mục này
    const files = await File.find({ folderId, userId });
    allFiles.push(...files);

    // 2. Tìm các thư mục con trực tiếp
    // Lưu ý: Đảm bảo field trong Model Folder của bạn là 'parentId' hoặc 'folderId'
    const subFolders = await Folder.find({ parentId: folderId, userId });

    // 3. Đệ quy để quét các thư mục con đó
    for (const subFolder of subFolders) {
        const { files: childFiles, folders: childFolders } = await getChildItems(subFolder._id, userId);
        allFiles.push(...childFiles);
        allFolders.push(...childFolders);
    }

    return { files: allFiles, folders: allFolders };
};

exports.deleteItems = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: "Danh sách ID không hợp lệ." });
        }

        const userId = req.user._id;
        let totalSizeReducted = 0;
        let cloudinaryIdsToDelete = [];
        let allFileIdsToDelete = new Set(); // Dùng Set để tránh trùng lặp ID
        let allFolderIdsToDelete = new Set();

        for (const id of ids) {
            // Kiểm tra xem ID là Folder hay File
            const folder = await Folder.findOne({ _id: id, userId });

            if (folder) {
                // Nếu là Folder: Lấy toàn bộ cây thư mục bên trong
                const { files, folders } = await getChildItems(id, userId);

                folders.forEach(fId => allFolderIdsToDelete.add(fId.toString()));
                files.forEach(f => {
                    allFileIdsToDelete.add(f._id.toString());
                    if (f.cloudinaryId) cloudinaryIdsToDelete.add(f.cloudinaryId);
                    totalSizeReducted += (f.size || 0);
                });
            } else {
                // Nếu là File: Kiểm tra trực tiếp
                const file = await File.findOne({ _id: id, userId });
                if (file) {
                    allFileIdsToDelete.add(file._id.toString());
                    if (file.cloudinaryId) cloudinaryIdsToDelete.push(file.cloudinaryId);
                    totalSizeReducted += (file.size || 0);
                }
            }
        }

        // Chuyển Set về Array để xử lý xóa
        const finalFileIds = Array.from(allFileIdsToDelete);
        const finalFolderIds = Array.from(allFolderIdsToDelete);

        if (finalFileIds.length === 0 && finalFolderIds.length === 0) {
            return res.status(404).json({ message: "Không tìm thấy dữ liệu để xóa." });
        }

        // --- BẮT ĐẦU QUÁ TRÌNH XÓA ---

        // 1. Xóa trên Cloudinary
        if (cloudinaryIdsToDelete.length > 0) {
            // Chuyển Set sang Array nếu bạn dùng Set cho cloudinaryIds
            await deleteMultipleFromCloudinary(Array.from(cloudinaryIdsToDelete));
        }

        // 2. Xóa trong Database
        if (finalFileIds.length > 0) {
            await File.deleteMany({ _id: { $in: finalFileIds } });
        }
        if (finalFolderIds.length > 0) {
            await Folder.deleteMany({ _id: { $in: finalFolderIds } });
        }

        // 3. Cập nhật dung lượng User
        if (totalSizeReducted > 0) {
            await User.findByIdAndUpdate(userId, {
                $inc: { usedStorage: -totalSizeReducted }
            });
        }

        res.json({
            message: `Xóa thành công ${finalFileIds.length} file và ${finalFolderIds.length} thư mục (bao gồm cả thư mục con).`,
            details: { files: finalFileIds.length, folders: finalFolderIds.length }
        });

    } catch (error) {
        console.error("Delete Error:", error);
        res.status(500).json({ message: "Lỗi hệ thống khi thực hiện xóa.", error: error.message });
    }
};

// 4. Di chuyển file sang thư mục khác
exports.moveFiles = async (req, res) => {
    try {
        const { fileIds, targetFolderId } = req.body;
        if (targetFolderId) {
            const folderExists = await Folder.findOne({
                _id: targetFolderId,
                userId: req.user._id
            });
            if (!folderExists) {
                return res.status(404).json({ message: "Thư mục đích không tồn tại hoặc không thuộc quyền sở hữu của bạn." });
            }
        }
        const result = await File.updateMany(
            {
                _id: { $in: fileIds },
                userId: req.user._id
            },
            {
                $set: { folderId: targetFolderId || null }
            }
        );

        res.json({
            message: `Thành công! Đã di chuyển ${result.modifiedCount} file vào thư mục mới.`,
            movedCount: result.modifiedCount
        });
    } catch (error) {
        res.status(500).json({ message: "Lỗi hệ thống khi di chuyển file.", error: error.message });
    }
};

exports.getFiles = async (req, res) => {
    try {
        // Lấy đúng logic xử lý folderId từ code cũ của bạn
        let folderId = req.query.folderId || null;
        // Fix lỗi nếu FE gửi chuỗi "null"
        if (folderId === 'null') folderId = null;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // Giữ nguyên Object Query như code cũ vì nó đang hoạt động tốt
        const query = {
            userId: req.user._id,
            folderId: folderId,
            isDeleted: false
        };

        // Thực hiện query có phân trang
        const [files, totalItems] = await Promise.all([
            File.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            File.countDocuments(query)
        ]);

        // Trả về cấu trúc có kèm phân trang
        res.json({
            files,
            pagination: {
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
                itemsPerPage: limit
            }
        });
    } catch (error) {
        console.error("Lỗi getFiles:", error);
        res.status(500).json({ message: "Lỗi khi lấy danh sách file." });
    }
};

// Lấy 30 ảnh mới nhất cho trang Recent
exports.getRecentFiles = async (req, res) => {
    try {
        const userId = req.user._id;

        // 1. Tìm tất cả các folder bị khóa TRỰC TIẾP
        const directlyLockedFolders = await Folder.find({
            userId: userId,
            'protection.status': 'locked'
        }).select('_id');

        if (directlyLockedFolders.length === 0) {
            // Nếu không có folder nào bị khóa, lấy 30 ảnh bình thường
            const recentPhotos = await File.find({
                userId: userId,
                mimeType: { $regex: /^image\// },
                isDeleted: false
            }).sort({ createdAt: -1 }).limit(30);
            return res.json(recentPhotos);
        }

        // 2. Thuật toán tìm tất cả folder con của các folder bị khóa
        let allLockedFolderIds = directlyLockedFolders.map(f => f._id);
        let searchIds = [...allLockedFolderIds];

        // Lặp để tìm các cấp con (Deep Search)
        while (searchIds.length > 0) {
            const subFolders = await Folder.find({
                userId: userId,
                parentId: { $in: searchIds } // Giả sử bạn dùng trường parentId để lưu cha
            }).select('_id');

            if (subFolders.length > 0) {
                const subIds = subFolders.map(f => f._id);
                allLockedFolderIds.push(...subIds);
                searchIds = subIds; // Tiếp tục tìm con của các con này
            } else {
                searchIds = [];
            }
        }

        // 3. Lấy 30 ảnh mới nhất, loại trừ tất cả file thuộc nhánh bị khóa
        const recentPhotos = await File.find({
            userId: userId,
            mimeType: { $regex: /^image\// },
            isDeleted: false,
            folderId: { $nin: allLockedFolderIds }
        })
            .sort({ createdAt: -1 })
            .limit(30);

        res.json(recentPhotos);
    } catch (error) {
        console.error("Lỗi getRecentFiles:", error);
        res.status(500).json({ message: "Lỗi hệ thống khi lấy ảnh gần đây." });
    }
};