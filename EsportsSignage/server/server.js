const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION ---
const DB_FILE = 'screens.json';
let screens = [];

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
    // Send the list of screens to Admin and Dashboard
    io.emit('update_screen_list', screens);
};

// --- SERVE STATIC FILES ---
app.use(express.static(path.join(__dirname, '../public')));

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    
    // 1. REGISTER SCREEN (The "Handshake")
    socket.on('register_screen', (deviceId) => {
        let screen = screens.find(s => s.deviceId === deviceId);

        if (!screen) {
            // New Screen: Create it
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
            console.log(`[NEW] Screen detected: ${deviceId}`);
            saveDB();
        } else {
            // Existing Screen: Update socket connection
            screen.socketId = socket.id;
            console.log(`[RECONNECT] ${screen.name}`);
        }

        // Send status back to screen
        if (screen.isPaired) {
            socket.emit('paired_success', { name: screen.name });
            // Restore content if it exists
            if (screen.lastContent) {
                socket.emit('update_content', screen.lastContent);
            }
        } else {
            socket.emit('show_pairing_code', screen.pairingCode);
        }
        
        broadcastScreenList();
    });

    // 2. ADMIN PAIRING
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

    // 3. PUSH CONTENT
    socket.on('push_content', ({ targetId, content }) => {
        // targetId comes from the dropdown (socketId)
        const screen = screens.find(s => s.socketId === targetId);
        
        if (screen) {
            io.to(screen.socketId).emit('update_content', content);
            
            // Save state so it persists on reboot
            screen.lastContent = content;
            saveDB();

            socket.emit('admin_log', `Sent content to ${screen.name}`);
        } else {
            socket.emit('admin_log', `Error: Target screen not found`);
        }
    });

    // 4. CLI COMMANDS
    socket.on('cli_command', (cmd) => {
        const parts = cmd.split(' ');
        const command = parts[0];

        if (command === 'refresh') {
            const targetId = parts[1];
            if (targetId) {
                 io.to(targetId).emit('force_refresh');
                 socket.emit('cli_response', `Refreshed ${targetId}`);
            } else {
                 io.emit('force_refresh');
                 socket.emit('cli_response', "Broadcasted global refresh.");
            }
        } else if (command === 'list') {
            const list = screens.map(s => `${s.name} [${s.isPaired ? 'PAIRED' : 'NEW'}]`).join('\n');
            socket.emit('cli_response', list);
        } else {
            socket.emit('cli_response', "Unknown command.");
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log('---------------------------------------');
    console.log(`  ESPORTS SIGNAGE SYSTEM v1.0`);
    console.log(`  Server running on Port ${PORT}`);
    console.log(`  Admin: http://localhost:${PORT}/admin.html`);
    console.log(`  Display: http://localhost:${PORT}/receiver.html`);
    console.log('---------------------------------------');
});