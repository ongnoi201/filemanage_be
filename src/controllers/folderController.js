const { chunkArray } = require('../config/utils');
const cloudinary = require('../config/storage');
const Folder = require('../models/Folder');
const File = require('../models/File');

const getAllSubFolderIds = async (folderId, userId) => {
    let ids = [folderId];
    const subFolders = await Folder.find({ parentId: folderId, userId, isDeleted: false });
    
    for (const sub of subFolders) {
        const subIds = await getAllSubFolderIds(sub._id, userId);
        ids = ids.concat(subIds);
    }
    return ids;
};

const isNameDuplicate = async (userId, parentId, name, excludeId = null) => {
    const query = {
        userId,
        parentId: parentId || null,
        name: name.trim(),
        isDeleted: false
    };
    if (excludeId) {
        query._id = { $ne: excludeId };
    }
    const existing = await Folder.findOne(query);
    return !!existing;
};

// Tạo thư mục mới
exports.createFolder = async (req, res) => {
    try {
        const { name, parentId } = req.body;
        const userId = req.user._id;

        // Kiểm tra trùng tên
        const existing = await Folder.findOne({
            userId,
            parentId: parentId || null,
            name: name.trim(),
            isDeleted: false
        });

        if (existing) {
            return res.status(400).json({ message: "Tên thư mục này đã tồn tại ở cấp hiện tại." });
        }

        const newFolder = new Folder({
            name: name.trim(),
            parentId: parentId || null,
            userId
        });

        await newFolder.save();
        res.status(201).json(newFolder);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi tạo thư mục." });
    }
};

// Đổi tên thư mục
exports.renameFolder = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const userId = req.user._id;

        const folder = await Folder.findOne({ _id: id, userId });
        if (!folder) return res.status(404).json({ message: "Không tìm thấy thư mục." });

        // Kiểm tra xem tên mới có trùng với thư mục khác cùng cấp không
        const duplicate = await Folder.findOne({
            userId,
            parentId: folder.parentId,
            name: name.trim(),
            _id: { $ne: id }, // Không kiểm tra chính nó
            isDeleted: false
        });

        if (duplicate) {
            return res.status(400).json({ message: "Tên thư mục đã được sử dụng." });
        }

        folder.name = name.trim();
        await folder.save();
        res.json(folder);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi đổi tên." });
    }
};

exports.getFolders = async (req, res) => {
    try {
        const parentId = req.query.parentId || null;
        const folders = await Folder.find({ 
            userId: req.user._id, 
            parentId: parentId,
            isDeleted: false 
        });
        res.json(folders);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi lấy danh sách thư mục." });
    }
};

// Di chuyển thư mục (Thay đổi parentId)
exports.moveFolder = async (req, res) => {
    try {
        const { id } = req.params; // ID thư mục đang muốn di chuyển
        const { newParentId } = req.body; // ID đích đến
        const userId = req.user._id;

        // 1. Nếu đích đến trùng với chính nó
        if (id === newParentId) {
            return res.status(400).json({ message: "Không thể di chuyển thư mục vào chính nó." });
        }

        // 2. Lấy toàn bộ danh sách ID con cháu của thư mục hiện tại
        // Sử dụng hàm getAllSubFolderIds bạn đã viết ở trên
        const allSubFolderIds = await getAllSubFolderIds(id, userId);

        // 3. Kiểm tra: Nếu newParentId nằm trong danh sách con cháu -> Lỗi logic
        if (newParentId && allSubFolderIds.includes(newParentId)) {
            return res.status(400).json({ 
                message: "Không thể di chuyển thư mục cha vào thư mục con của nó." 
            });
        }

        // 4. Tìm thư mục cần di chuyển
        const folder = await Folder.findOne({ _id: id, userId });
        if (!folder) return res.status(404).json({ message: "Không tìm thấy thư mục." });

        // 5. Kiểm tra trùng tên tại nơi đến (Sử dụng helper ở bước 1)
        const duplicate = await Folder.findOne({
            userId,
            parentId: newParentId || null,
            name: folder.name,
            _id: { $ne: id },
            isDeleted: false
        });

        if (duplicate) {
            return res.status(400).json({ message: "Tại thư mục đích đã có thư mục cùng tên." });
        }

        // 6. Thực hiện di chuyển
        folder.parentId = newParentId || null;
        await folder.save();

        res.json({ message: "Di chuyển thành công.", folder });
    } catch (error) {
        console.error("Move Folder Error:", error);
        res.status(500).json({ message: "Lỗi hệ thống khi di chuyển." });
    }
};

exports.deleteFolder = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const allFolderIds = await getAllSubFolderIds(id, userId);
        const filesToDelete = await File.find({ 
            folderId: { $in: allFolderIds }, 
            userId 
        }).select('cloudinaryId');

        const publicIds = filesToDelete.map(file => file.cloudinaryId);
        if (publicIds.length > 0) {
            const chunks = chunkArray(publicIds, 100);
            
            for (const chunk of chunks) {
                await cloudinary.api.delete_resources(chunk);
            }
            console.log(`Đã xóa ${publicIds.length} files trên Cloudinary.`);
        }

        await File.deleteMany({ folderId: { $in: allFolderIds }, userId });
        await Folder.deleteMany({ _id: { $in: allFolderIds }, userId });

        res.json({ 
            message: "Xóa thành công thư mục và toàn bộ dữ liệu bên trong.",
            deletedFoldersCount: allFolderIds.length,
            deletedFilesCount: publicIds.length
        });

    } catch (error) {
        console.error("Lỗi xóa đệ quy:", error);
        res.status(500).json({ message: "Lỗi hệ thống khi xóa thư mục." });
    }
};

// Tìm kiếm thư mục theo tên
exports.searchAll = async (req, res) => {
    try {
        const { q, page = 1, limit = 20 } = req.query;
        const skip = (page - 1) * limit;

        // Nếu không có từ khóa, trả về mảng rỗng hoặc báo lỗi
        if (!q) return res.json({ folders: [], files: [] });

        const query = {
            userId: req.user._id,
            isDeleted: false,
            // Sử dụng regex nhưng nhờ Index {userId, isDeleted, name} nó sẽ lọc nhanh hơn
            name: { $regex: q, $options: 'i' }
        };

        const [folders, files] = await Promise.all([
            Folder.find(query).limit(Number(limit)).skip(skip).lean(),
            File.find(query).limit(Number(limit)).skip(skip).lean()
        ]);

        res.json({ folders, files });
    } catch (error) {
        res.status(500).json({ message: "Lỗi tìm kiếm." });
    }
};