require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();
connectDB();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/files', require('./routes/fileRoutes'));
app.use('/api/folders', require('./routes/folderRoutes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('SERVER running...'));