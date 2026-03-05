const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    type: {type: String,required: true, default: 'file'},
    originalName: { type: String },
    extension: { type: String },
    mimeType: { type: String },
    size: { type: Number, required: true }, 
    url: { type: String, required: true }, 
    cloudinaryId: { type: String, required: true },
    folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isFavorite: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
}, { timestamps: true });

fileSchema.index({ userId: 1, isDeleted: 1, name: 1 }); 
module.exports = mongoose.model('File', fileSchema);