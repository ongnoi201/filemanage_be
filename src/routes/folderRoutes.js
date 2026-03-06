const express = require('express');
const router = express.Router();
const folderController = require('../controllers/folderController');
const auth = require('../middlewares/auth');

router.use(auth);

// Các routes cũ
router.post('/', folderController.createFolder);
router.get('/', folderController.getFolders);

// Các routes mới bổ sung
router.get('/search', folderController.searchAll); // Tìm kiếm
router.patch('/:id/rename', folderController.renameFolder); // Đổi tên
router.patch('/:id/move', folderController.moveFolder); // Di chuyển
router.delete('/:id', folderController.deleteFolder); // Xóa (soft delete)

router.post('/lock-multiple', folderController.lockFolders);
router.post('/unlock', folderController.unlockFolder);

module.exports = router;