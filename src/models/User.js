const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    fname: { type: String },
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    avatar: { type: String, default: "" },
    cover: { type: String, default: "" },
    storageLimit: { type: Number, default: 1073741824 },
    usedStorage: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    faceDescriptors: { type: [[Number]], default: [] },
    hasFaceId: { type: Boolean, default: false 
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);