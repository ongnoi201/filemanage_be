const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const auth = require('../middlewares/auth');
const { upload } = require('../config/storage');

router.post('/upload', auth, upload.array('files', 10), fileController.uploadFiles);
router.get('/', auth, fileController.getFiles);
router.patch('/:id/rename', auth, fileController.renameFile);
router.post('/move', auth, fileController.moveFiles);
router.post('/delete-items', auth, fileController.deleteItems);
router.get('/recent', auth, fileController.getRecentFiles);

module.exports = router;