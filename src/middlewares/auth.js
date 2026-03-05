const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: "Không tìm thấy token, quyền truy cập bị từ chối." });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({ message: "Người dùng không tồn tại." });
        }
        req.user = user;
        req.token = token;
        next();
    } catch (error) {
        res.status(401).json({ message: "Token không hợp lệ hoặc đã hết hạn." });
    }
};

module.exports = auth;