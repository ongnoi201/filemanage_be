const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middlewares/auth');
const { uploadProfile } = require('../config/storage');

router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/stats', auth, userController.getStorageStats);
router.post('/register-face', auth, userController.registerFace);
router.post('/login-face', userController.loginWithFace);
router.get('/me', auth, userController.getMe);
router.post('/face/count', auth, userController.countFaceDescriptors);
router.delete('/face/clear', auth, userController.clearFaceDescriptors);
router.put('/update', 
    auth, 
    uploadProfile.fields([
        { name: 'avatar', maxCount: 1 }, 
        { name: 'cover', maxCount: 1 }
    ]), 
    userController.updateProfile
);
router.get('/all', auth, userController.getAllUsers);
router.delete('/:id', auth, userController.deleteUser);
module.exports = router;