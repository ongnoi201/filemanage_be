const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    type: {type: String, required: true, default: 'folder'},
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    path: { type: String, default: '/' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
}, { timestamps: true });

folderSchema.index({ userId: 1, isDeleted: 1, name: 1 });
module.exports = mongoose.model('Folder', folderSchema);