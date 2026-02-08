const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer'); // NEW: Handles file uploads

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION ---
const DB_FILE = 'screens.json';
const UPLOAD_DIR = path.join(__dirname, '../public/uploads'); // Store files here
let screens = [];

// --- SETUP: ENSURE DIRECTORIES EXIST ---
// Create the uploads folder if it doesn't exist yet
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// --- PERSISTENCE: LOAD DATA ---
if (fs.existsSync(DB_FILE)) {
    try {
        screens = JSON.parse(fs.readFileSync(DB_FILE));
        console.log(`[SYSTEM] Loaded ${screens.length} screens from disk.`);
    } catch (e) {
        console.error("[ERROR] Could not read database:", e);
    }
}

// --- HELPER FUNCTIONS ---
const saveDB = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(screens, null, 2));
        broadcastScreenList();
    } catch (e) {
        console.error("[ERROR] Could not save database:", e);
    }
};

const broadcastScreenList = () => {
    io.emit('update_screen_list', screens);
};

// --- UPLOAD ENGINE (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        // Keep original extension (e.g. .mp4, .png) but make filename unique
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});
const upload = multer({ storage: storage });

// --- SERVE STATIC FILES ---
app.use(express.static(path.join(__dirname, '../public')));

// --- HTTP ROUTES ---

// 1. UPLOAD ENDPOINT
// The Admin page will POST files here. We save them, then return the URL.
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file received" });
    
    // The file is saved in 'public/uploads', so the URL is just '/uploads/filename'
    const fileUrl = `/uploads/${req.file.filename}`;
    
    console.log(`[UPLOAD] Saved new media: ${fileUrl}`);
    res.json({ url: fileUrl });
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    
    // 1. REGISTER SCREEN
    socket.on('register_screen', (deviceId) => {
        let screen = screens.find(s => s.deviceId === deviceId);

        if (!screen) {
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            screen = {
                deviceId: deviceId,    
                socketId: socket.id,   
                pairingCode: code,
                name: "Unpaired Screen",
                isPaired: false,
                lastContent: null      
            };
            screens.push(screen);
            saveDB();
        } else {
            screen.socketId = socket.id;
        }

        if (screen.isPaired) {
            socket.emit('paired_success', { name: screen.name });
            if (screen.lastContent) {
                socket.emit('update_content', screen.lastContent);
            }
        } else {
            socket.emit('show_pairing_code', screen.pairingCode);
        }
        
        broadcastScreenList();
    });

    // 2. ADMIN PAIRING (CREATE/UPDATE)
    socket.on('admin_pair', ({ code, name }) => {
        const screen = screens.find(s => s.pairingCode == code);
        if (screen) {
            screen.name = name;
            screen.isPaired = true;
            io.to(screen.socketId).emit('paired_success', { name });
            saveDB();
            socket.emit('admin_log', `Success: Paired ${name}`);
        } else {
            socket.emit('admin_log', `Error: Code ${code} not found`);
        }
    });

    // 3. ADMIN RENAME (UPDATE)
    socket.on('admin_rename_screen', ({ socketId, newName }) => {
        const screen = screens.find(s => s.socketId === socketId);
        if (screen) {
            screen.name = newName;
            io.to(screen.socketId).emit('paired_success', { name: newName });
            saveDB();
            socket.emit('admin_log', `Renamed screen to ${newName}`);
        }
    });

    // 4. ADMIN DELETE (DELETE)
    socket.on('admin_delete_screen', (socketId) => {
        const index = screens.findIndex(s => s.socketId === socketId);
        if (index !== -1) {
            const screen = screens[index];
            // Tell the screen it is no longer paired (optional, forces it to show code)
            io.to(screen.socketId).emit('show_pairing_code', screen.pairingCode); // Reset screen UI
            
            // Remove from array
            screens.splice(index, 1);
            saveDB();
            socket.emit('admin_log', `Deleted screen: ${screen.name}`);
        }
    });

    // 5. PUSH CONTENT
    socket.on('push_content', ({ targetId, content }) => {
        const screen = screens.find(s => s.socketId === targetId);
        if (screen) {
            io.to(screen.socketId).emit('update_content', content);
            screen.lastContent = content;
            saveDB();
            socket.emit('admin_log', `Sent content to ${screen.name}`);
        }
    });

    // 6. CLI COMPENDIUM (RESTORED & EXPANDED)
    socket.on('cli_command', (cmdString) => {
        // Basic parser: "say 123 hello world" -> cmd="say", arg1="123", rest="hello world"
        const parts = cmdString.trim().split(' ');
        const cmd = parts[0].toLowerCase();
        const arg1 = parts[1];
        const rest = parts.slice(2).join(' ');

        switch (cmd) {
            case 'help':
                socket.emit('cli_response', 
`=== COMMAND COMPENDIUM ===
list              : Show all connected screens
refresh [id|all]  : Reload the browser on target
identify [id]     : Flash screen to identify
say [id] [msg]    : Send text alert to screen
wipe [id]         : Unpair and delete screen
help              : Show this menu`);
                break;

            case 'list':
                if (screens.length === 0) {
                    socket.emit('cli_response', "No screens connected.");
                } else {
                    const output = screens.map(s => 
                        `[${s.socketId}] ${s.name} (${s.isPaired ? 'ONLINE' : 'PENDING'})`
                    ).join('\n');
                    socket.emit('cli_response', output);
                }
                break;

            case 'refresh':
                if (arg1 === 'all' || !arg1) {
                    io.emit('force_refresh');
                    socket.emit('cli_response', "Broadcasted GLOBAL REFRESH.");
                } else {
                    io.to(arg1).emit('force_refresh');
                    socket.emit('cli_response', `Refreshed target: ${arg1}`);
                }
                break;
            
            case 'identify':
                if (arg1) {
                    // Send a visual signal (Client needs to handle 'identify' event)
                    io.to(arg1).emit('identify'); 
                    socket.emit('cli_response', `Sent ID signal to ${arg1}`);
                } else {
                    socket.emit('cli_response', "Usage: identify [socketId]");
                }
                break;

            case 'say':
                if (arg1 && rest) {
                     io.to(arg1).emit('show_alert', rest); 
                     socket.emit('cli_response', `Sent message to ${arg1}`);
                } else {
                    socket.emit('cli_response', "Usage: say [socketId] [message]");
                }
                break;
                
             case 'wipe':
                const index = screens.findIndex(s => s.socketId === arg1);
                if (index !== -1) {
                    const s = screens[index];
                    io.to(s.socketId).emit('show_pairing_code', s.pairingCode);
                    screens.splice(index, 1);
                    saveDB();
                    socket.emit('cli_response', `Deleted screen: ${s.name}`);
                } else {
                    socket.emit('cli_response', "Screen ID not found.");
                }
                break;

            default:
                socket.emit('cli_response', `Unknown command: ${cmd}. Type 'help' for options.`);
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on Port ${PORT}`);
});