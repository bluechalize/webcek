// Import library
const express = require('express');
const axios = require('axios');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session'); // Untuk session management
const app = express();
const PORT = 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Session configuration
app.use(session({
    secret: 'rahasia', // Kunci rahasia untuk enkripsi session
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set true jika menggunakan HTTPS
}));

// Fungsi untuk memformat tanggal menjadi dd-mmm-yyyy
function formatDate(date) {
    const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const day = String(date.getDate()).padStart(2, '0');
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
}

// Fungsi keterangan status
function getStatusDescription(statusCode) {
    const statusCodes = {
        200: 'OK - Permintaan berhasil diproses.',
        201: 'Created - Sumber daya baru berhasil dibuat.',
        400: 'Bad Request - Permintaan tidak valid atau salah format.',
        401: 'Unauthorized - Akses ditolak karena autentikasi gagal.',
        403: 'Forbidden - Akses ditolak karena tidak memiliki izin.',
        404: 'Not Found - Sumber daya yang diminta tidak ditemukan.',
        500: 'Internal Server Error - Terjadi kesalahan di server.',
        503: 'Service Unavailable - Server sedang tidak tersedia.',
        default: 'Unknown - Kode status tidak dikenali.'
    };
    return statusCodes[statusCode] || statusCodes.default;
}
// Fungsi untuk menggambar tabel di PDF
function drawTable(doc, data) {
    const tableTop = 100; // Posisi vertikal awal tabel
    const rowHeight = 20; // Tinggi setiap baris
    const columns = [
        { title: 'No.', width: 20 },
        { title: 'URL', width: 140 },
        { title: 'Status', width: 70 },
        { title: 'Kode Status', width: 60 },
        { title: 'Keterangan Kode Status', width: 130 },
        { title: 'Tanggal Pengecekan', width: 90 },
        { title: 'Tanggal Terakhir Diperbarui', width: 110 }
    ];

    // Gambar header tabel
    let xOffset = 50; // Posisi horizontal awal
    columns.forEach((column) => {
        doc.font('Helvetica-Bold').fontSize(10).text(column.title, xOffset, tableTop);
        xOffset += column.width;
    });

    // Gambar baris data
    let yOffset = tableTop + rowHeight; // Posisi vertikal baris pertama
    data.forEach((row, index) => {
        xOffset = 50; // Reset posisi horizontal
        doc.font('Helvetica').fontSize(10);

        // Kolom No.
        doc.text(`${index + 1}`, xOffset, yOffset);
        xOffset += columns[0].width;

        // Kolom URL
        doc.text(row.url, xOffset, yOffset);
        xOffset += columns[1].width;

        // Kolom Status
        doc.text(row.status, xOffset, yOffset);
        xOffset += columns[2].width;

        // Kolom Kode Status
        doc.text(`${row.statusCode}`, xOffset, yOffset);
        xOffset += columns[3].width;

        // Kolom Keterangan Kode Status
        doc.text(row.statusDescription, xOffset, yOffset);
        xOffset += columns[4].width;

        // Kolom Tanggal Pengecekan
        doc.text(row.tanggalPengecekan, xOffset, yOffset);
        xOffset += columns[5].width;

        // Kolom Tanggal Terakhir Diperbarui
        doc.text(row.lastUpdatedContent, xOffset, yOffset);

        yOffset += rowHeight; // Pindah ke baris berikutnya
    });
}

// Database SQLite
const db = new sqlite3.Database('./database.db');

// Buat tabel jika belum ada
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS websites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE
        )
    `);
});

// Data user (hardcoded untuk contoh)
const users = [
    { username: 'admin', password: 'password123' },
    { username: 'user', password: 'userpass' }
];

// Middleware untuk memastikan pengguna sudah login
function ensureAuthenticated(req, res, next) {
    if (req.session.user) {
        return next(); // Lanjutkan jika sudah login
    }
    res.redirect('/login'); // Redirect ke halaman login jika belum login
}

// Halaman login
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Proses login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        req.session.user = user; // Simpan user di session
        res.redirect('/'); // Redirect ke halaman utama setelah login
    } else {
        res.render('login', { error: 'Username atau password salah!' });
    }
});

// Halaman utama
app.get('/', ensureAuthenticated, async (req, res) => {
    // Ambil semua URL dari database
    db.all('SELECT * FROM websites', [], (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        // Kirim objek req ke template
        res.render('index', { websites: rows, req: req });
    });
});
// Endpoint untuk logout
app.post('/logout', (req, res) => {
    // Hapus session pengguna
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Error during logout');
        }
        // Redirect ke halaman utama setelah logout
        res.redirect('/');
    });
});
// Endpoint untuk memeriksa status situs web
app.post('/check', ensureAuthenticated, async (req, res) => {
    const { urls } = req.body;
    const urlList = urls.split('\n').map(url => url.trim()).filter(url => url);
    const results = [];
    for (const url of urlList) {
        try {
            const fullUrl = url.startsWith('http') ? url : `http://${url}`;
            const response = await axios.get(fullUrl, { timeout: 5000 });
            results.push({ url, status: 'Aktif', statusCode: response.status });
        } catch (error) {
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                results.push({ url, status: 'Tidak Aktif', statusCode: null });
            } else if (error.response) {
                results.push({ url, status: 'Tidak Aktif', statusCode: error.response.status });
            } else {
                results.push({ url, status: 'Tidak Aktif', statusCode: null });
            }
        }
    }
    res.render('report', { results });
});

// Halaman untuk mengelola URL
app.get('/manage', ensureAuthenticated, (req, res) => {
    db.all('SELECT * FROM websites', [], (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        res.render('manage', { websites: rows });
    });
});

// Endpoint untuk menambahkan URL ke database
app.post('/add-url', ensureAuthenticated, (req, res) => {
    const { url } = req.body;
    db.run('INSERT INTO websites (url) VALUES (?)', [url], function (err) {
        if (err) {
            return res.status(500).send('Gagal menambahkan URL');
        }
        res.redirect('/manage');
    });
});

// Endpoint untuk menghapus URL dari database
app.post('/delete-url/:id', ensureAuthenticated, (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM websites WHERE id = ?', [id], function (err) {
        if (err) {
            return res.status(500).send('Gagal menghapus URL');
        }
        res.redirect('/manage');
    });
});

// Endpoint dashboard
app.get('/dashboard', ensureAuthenticated, async (req, res) => {
    db.all('SELECT * FROM websites', [], async (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        const results = [];
        let activeCount = 0;
        let inactiveCount = 0;
        const statusCodes = {};
        for (const row of rows) {
            const url = row.url;
            try {
                const fullUrl = url.startsWith('http') ? url : `http://${url}`;
                const response = await axios.get(fullUrl, { timeout: 5000 });
                activeCount++;
                const statusCode = response.status;
                statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
            } catch (error) {
                inactiveCount++;
            }
        }
        res.render('dashboard', {
            activeCount,
            inactiveCount,
            statusCodes
        });
    });
});

// Endpoint untuk memeriksa status semua URL dari database
app.get('/check-all', ensureAuthenticated, async (req, res) => {
    db.all('SELECT * FROM websites', [], async (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        const results = [];
        for (const row of rows) {
            const url = row.url;
            try {
                const fullUrl = url.startsWith('http') ? url : `http://${url}`;
                const response = await axios.get(fullUrl, { timeout: 5000 });
                let lastUpdatedContent = response.headers['last-modified'] || 'Tidak Diketahui';
                const statusDescription = getStatusDescription(response.status);
                results.push({
                    url,
                    status: 'Aktif',
                    statusCode: response.status,
                    statusDescription,
                    tanggalPengecekan: formatDate(new Date()),
                    lastUpdatedContent
                });
            } catch (error) {
                const statusCode = error.response ? error.response.status : null;
                const statusDescription = statusCode
                    ? getStatusDescription(statusCode)
                    : 'Tidak Dapat Dihubungi - Situs tidak aktif atau tidak tersedia.';
                results.push({
                    url,
                    status: 'Tidak Aktif',
                    statusCode: statusCode || '-',
                    statusDescription,
                    tanggalPengecekan: formatDate(new Date()),
                    lastUpdatedContent: 'Tidak Diketahui'
                });
            }
        }
        res.render('report', { results });
    });
});

// Endpoint untuk mengunduh laporan sebagai file CSV
app.get('/export-csv', ensureAuthenticated, async (req, res) => {
    db.all('SELECT * FROM websites', [], async (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        const results = [];
        for (const row of rows) {
            const url = row.url;
            try {
                const fullUrl = url.startsWith('http') ? url : `http://${url}`;
                const response = await axios.get(fullUrl, { timeout: 5000 });
                let lastUpdatedContent = response.headers['last-modified'] || 'Tidak Diketahui';
                const statusDescription = getStatusDescription(response.status);
                results.push({
                    url,
                    status: 'Aktif',
                    statusCode: response.status,
                    statusDescription,
                    tanggalPengecekan: formatDate(new Date()),
                    lastUpdatedContent
                });
            } catch (error) {
                const statusCode = error.response ? error.response.status : null;
                const statusDescription = statusCode
                    ? getStatusDescription(statusCode)
                    : 'Tidak Dapat Dihubungi - Situs tidak aktif atau tidak tersedia.';
                results.push({
                    url,
                    status: 'Tidak Aktif',
                    statusCode: statusCode || '-',
                    statusDescription,
                    tanggalPengecekan: formatDate(new Date()),
                    lastUpdatedContent: 'Tidak Diketahui'
                });
            }
        }
        const csvHeader = 'No.;URL;Status;Kode Status;Keterangan Kode Status;Tanggal Pengecekan;Tanggal Terakhir Diperbarui\n';
        const csvRows = results.map((result, index) =>
            `${index + 1};${result.url};${result.status};${result.statusCode};${result.statusDescription};${result.tanggalPengecekan};${result.lastUpdatedContent}`
        ).join('\n');
        const csvContent = csvHeader + csvRows;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=website_status_report.csv');
        res.send(csvContent);
    });
});
const fs = require('fs'); // Untuk menulis file PDF sementara
const PDFDocument = require('pdfkit'); // Library untuk membuat PDF

// Endpoint untuk mengunduh laporan sebagai file PDF
app.get('/export-pdf', async (req, res) => {
    db.all('SELECT * FROM websites', [], async (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }

        const results = [];
        for (const row of rows) {
            const url = row.url;
            try {
                const fullUrl = url.startsWith('http') ? url : `http://${url}`;
                const response = await axios.get(fullUrl, { timeout: 5000 });
                let lastUpdatedContent = response.headers['last-modified'] || 'Tidak Diketahui';
                const statusDescription = getStatusDescription(response.status);
                results.push({
                    url,
                    status: 'Aktif',
                    statusCode: response.status,
                    statusDescription: statusDescription,
                    tanggalPengecekan: formatDate(new Date()),
                    lastUpdatedContent: lastUpdatedContent
                });
            } catch (error) {
                const statusCode = error.response ? error.response.status : null;
                const statusDescription = statusCode
                    ? getStatusDescription(statusCode)
                    : 'Tidak Dapat Dihubungi - Situs tidak aktif atau tidak tersedia.';
                results.push({
                    url,
                    status: 'Tidak Aktif',
                    statusCode: statusCode || '-',
                    statusDescription: statusDescription,
                    tanggalPengecekan: formatDate(new Date()),
                    lastUpdatedContent: 'Tidak Diketahui'
                });
            }
        }

        // Buat dokumen PDF
        const doc = new PDFDocument();
        const filePath = path.join(__dirname, 'public', 'website_status_report.pdf');
        const writeStream = fs.createWriteStream(filePath);
        doc.pipe(writeStream);

        // Judul PDF
        doc.fontSize(20).text('Laporan Status Situs Web', { align: 'center' }).moveDown();

        // Gambar tabel
        drawTable(doc, results);

        // Akhiri dokumen
        doc.end();

        // Kirim file PDF setelah selesai ditulis
        writeStream.on('finish', () => {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=website_status_report.pdf');
            res.sendFile(filePath, (err) => {
                if (err) {
                    console.error('Error sending PDF:', err);
                }
                // Hapus file PDF setelah dikirim
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error('Error deleting PDF:', unlinkErr);
                    }
                });
            });
        });
    });
});
// Jalankan server
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});