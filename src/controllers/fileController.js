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
        console.log('Lỗi server khi upload file');
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

exports.deleteItems = async (req, res) => {
    try {
        const { ids } = req.body; // ids là mảng chứa các ID của File hoặc Folder cần xóa
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: "Danh sách ID không hợp lệ." });
        }

        const userId = req.user._id;
        let totalSizeReducted = 0;
        let cloudinaryIdsToDelete = [];
        let allFileIdsToDelete = [];
        let allFolderIdsToDelete = [];

        // 1. Phân loại và lấy thông tin
        for (const id of ids) {
            // Kiểm tra xem ID này là Folder hay File
            const folder = await Folder.findOne({ _id: id, userId });

            if (folder) {
                // Nếu là Folder: Tìm tất cả file bên trong (bao gồm cả thư mục con nếu có cấu trúc đệ quy)
                // Lưu ý: Nếu bạn có nhiều cấp thư mục, cần tìm tất cả file có folderId nằm trong cây thư mục này
                const filesInFolder = await File.find({ folderId: id, userId });

                allFolderIdsToDelete.push(id);
                filesInFolder.forEach(f => {
                    allFileIdsToDelete.push(f._id);
                    if (f.cloudinaryId) cloudinaryIdsToDelete.push(f.cloudinaryId);
                    totalSizeReducted += f.size;
                });
            } else {
                // Nếu là File: Kiểm tra trực tiếp
                const file = await File.findOne({ _id: id, userId });
                if (file) {
                    allFileIdsToDelete.push(file._id);
                    if (file.cloudinaryId) cloudinaryIdsToDelete.push(file.cloudinaryId);
                    totalSizeReducted += file.size;
                }
            }
        }

        if (allFileIdsToDelete.length === 0 && allFolderIdsToDelete.length === 0) {
            return res.status(404).json({ message: "Không tìm thấy dữ liệu để xóa." });
        }

        // 2. Xóa trên Cloudinary (nếu có file)
        if (cloudinaryIdsToDelete.length > 0) {
            await deleteMultipleFromCloudinary(cloudinaryIdsToDelete);
        }

        // 3. Xóa trong Database
        if (allFileIdsToDelete.length > 0) {
            await File.deleteMany({ _id: { $in: allFileIdsToDelete } });
        }
        if (allFolderIdsToDelete.length > 0) {
            await Folder.deleteMany({ _id: { $in: allFolderIdsToDelete } });
        }

        // 4. Cập nhật dung lượng User
        if (totalSizeReducted > 0) {
            await User.findByIdAndUpdate(userId, {
                $inc: { usedStorage: -totalSizeReducted }
            });
        }

        res.json({
            message: `Xóa thành công ${allFileIdsToDelete.length} file và ${allFolderIdsToDelete.length} thư mục.`,
            details: { files: allFileIdsToDelete.length, folders: allFolderIdsToDelete.length }
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
        const folderId = req.query.folderId || null;
        const files = await File.find({
            userId: req.user._id,
            folderId: folderId,
            isDeleted: false
        });
        res.json(files);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi lấy danh sách file." });
    }
};

// Lấy 30 ảnh mới nhất cho trang Recent
exports.getRecentFiles = async (req, res) => {
    try {
        const userId = req.user._id;

        const recentPhotos = await File.find({
            userId: userId,
            // Sử dụng Regex để lọc các file có mimeType là image (image/jpeg, image/png, etc.)
            mimeType: { $regex: /^image\// },
            // Đảm bảo file chưa bị xóa (nếu bạn có dùng soft delete)
            // isDeleted: false 
        })
        .sort({ createdAt: -1 }) // Mới nhất lên đầu
        .limit(30); // Giới hạn 30 mục

        res.json(recentPhotos);
    } catch (error) {
        console.error("Lỗi getRecentFiles:", error);
        res.status(500).json({ message: "Lỗi hệ thống khi lấy ảnh gần đây." });
    }
};