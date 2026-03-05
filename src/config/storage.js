const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

const fileStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'file_manage/uploads',
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'],
        public_id: (req, file) => `file_${Date.now()}_${file.originalname.split('.')[0]}`
    }
});

const profileStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'file_manage/profiles',
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'],
        public_id: (req, file) => `profile_${Date.now()}_${req.user._id}`
    }
});

const upload = multer({ storage: fileStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadProfile = multer({ storage: profileStorage, limits: { fileSize: 2 * 1024 * 1024 } });

const deleteMultipleFromCloudinary = async (publicIds) => {
    try {
        if (!publicIds || publicIds.length === 0) return;
        await cloudinary.api.delete_resources(publicIds);
    } catch (error) {
        console.error("Cloudinary Bulk Delete Error:", error);
    }
};

const deleteFromCloudinary = async (url) => {
    try {
        if (!url || !url.includes('cloudinary')) return;
        const parts = url.split('/');
        const fileName = parts.pop().split('.')[0];
        const folderPath = parts.slice(parts.indexOf('upload') + 2).join('/');
        const publicId = `${folderPath}/${fileName}`;
        await cloudinary.uploader.destroy(publicId);
    } catch (error) {
        console.error("Cloudinary Delete Error:", error);
    }
};

module.exports = { upload, uploadProfile, cloudinary, deleteFromCloudinary, deleteMultipleFromCloudinary };