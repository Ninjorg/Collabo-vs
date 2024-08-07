const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const SECRET_KEY = 'your_secret_key'; // Use a secure key in production

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// User data file and chat directory
const USERS_FILE = path.join(__dirname, 'users.json');
const CHATS_DIR = path.join(__dirname, 'chats');

// Ensure the chats directory exists
if (!fs.existsSync(CHATS_DIR)) {
    fs.mkdirSync(CHATS_DIR);
}

// Default chats to be initialized
const DEFAULT_CHATS = ['general', 'homework', 'counting'];

// Utility function to read user data from file
const readUsers = () => {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(USERS_FILE));
};

// Utility function to write user data to file
const writeUsers = (users) => {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

// Update isActive status of a user
const updateUserStatus = (username, status) => {
    const users = readUsers();
    const user = users.find(u => u.username === username);
    if (user) {
        user.isActive = status;
        writeUsers(users);
    }
};

// Initialize default chats
const initializeDefaultChats = () => {
    DEFAULT_CHATS.forEach(chatName => {
        const chatFilePath = path.join(CHATS_DIR, `${chatName}.json`);
        if (!fs.existsSync(chatFilePath)) {
            fs.writeFileSync(chatFilePath, JSON.stringify([]));
        }
    });
};

// Initialize default chats for a specific user
const initializeDefaultChatsForUser = (username) => {
    const defaultChats = ['general', 'homework', 'counting'];
    const users = readUsers();
    const user = users.find(u => u.username === username);

    if (user) {
        const missingChats = defaultChats.filter(chat => !user.chats.includes(chat));
        user.chats = [...new Set([...user.chats, ...missingChats])];
        writeUsers(users);
        console.log(`Default chats assigned to user ${username}`);
    }
};

// Update users with default chats
const updateUsersWithDefaultChats = () => {
    const users = readUsers();
    users.forEach(user => {
        const missingChats = DEFAULT_CHATS.filter(chat => !user.chats.includes(chat));
        if (missingChats.length > 0) {
            user.chats = [...new Set([...user.chats, ...DEFAULT_CHATS])];
        }
    });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

// Initialize default chats and update existing users at startup
initializeDefaultChats();
updateUsersWithDefaultChats();

// Function to update the chat file
const updateChatFile = (chatId, users) => {
    const chatFilePath = path.join(CHATS_DIR, `${chatId}.json`);

    fs.readFile(chatFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error(`Error reading chat file ${chatId}.json:`, err);
            return;
        }

        try {
            // Clean the JSON data by removing unexpected characters if possible
            let cleanData = data.replace(/[\u0000-\u0019]+/g, ""); // Remove control characters

            // Parse the chat JSON data
            let chatData = JSON.parse(cleanData);

            // Ensure chatData is an array
            if (!Array.isArray(chatData)) {
                chatData = [chatData];
            }

            // Find the users section
            let usersSection = chatData.find(section => section.users !== undefined);

            if (!usersSection) {
                usersSection = { users: [] };
                chatData.push(usersSection);
            }

            // Add new users to the users section
            users.forEach(username => {
                if (!usersSection.users.includes(username)) {
                    usersSection.users.push(username);
                }
            });

            // Write the updated data back to the file
            fs.writeFile(chatFilePath, JSON.stringify(chatData, null, 2), 'utf8', err => {
                if (err) {
                    console.error(`Error writing to chat file ${chatId}.json:`, err);
                } else {
                    console.log(`Users added to chat ${chatId}.json:`, users);
                }
            });
        } catch (parseErr) {
            console.error(`Error parsing chat file ${chatId}.json:`, parseErr);
            console.error(`Problematic content:\n${data}`);
        }
    });
};

// Add a chat to a user's chats
const addChatToUser = (userEmail, chatId) => {
    const users = readUsers();
    const user = users.find(user => user.email === userEmail);
    if (user) {
        // Use Set to ensure unique chat IDs
        const userChatsSet = new Set(user.chats);
        userChatsSet.add(chatId);
        user.chats = Array.from(userChatsSet);
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        
        // Update the chat file with the new user
        updateChatFile(chatId, [user.username]);
    }
};

// Sign-up route
app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;
    const users = readUsers();

    if (users.find(user => user.email === email)) {
        return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { username, email, password: hashedPassword, chats: [] };
    addChatToUser(email, DEFAULT_CHATS[0]); // Add user to the default 'general' chat
    users.push(newUser);

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    res.status(201).json({ message: 'User created' });
});

// Login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const users = readUsers();
    const user = users.find(user => user.email === email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ email: user.email, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ token, username: user.username }); // Send the username
});

// Middleware to check authentication
const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Fetch user chats
app.get('/userChats', authenticateToken, (req, res) => {
    const user = readUsers().find(user => user.email === req.user.email);
    if (user) {
        res.json({ chats: user.chats });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});

// Socket.IO middleware to authenticate users
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        console.error('Authentication error: Token is missing');
        return next(new Error('Authentication error'));
    }

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            console.error('Authentication error:', err.message);
            return next(new Error('Authentication error'));
        }
        console.log('Authenticated user:', user); // Debug: Check the decoded user object
        socket.user = user;
        next();
    });
});

// On user connection
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Update user status to active
    updateUserStatus(socket.user.username, true);

    // Notify all clients about the user list update
    const users = readUsers();
    io.emit('updateUsers', users);

    // Handle user disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Update user status to inactive
        updateUserStatus(socket.user.username, false);

        // Notify all clients about the user list update
        const users = readUsers();
        io.emit('updateUsers', users);
    });

    // Handle joining a chat
    socket.on('joinChat', (chatId) => {
        socket.join(chatId);
        console.log(`User ${socket.user.username} joined chat ${chatId}`);
        
        // Fetch and emit chat messages
        const chatFilePath = path.join(__dirname, 'chats', `${chatId}.json`);
        if (fs.existsSync(chatFilePath)) {
            const chatData = JSON.parse(fs.readFileSync(chatFilePath, 'utf8'));
            socket.emit('chatMessages', chatData);
        }
    });

    // Handle message sending
    socket.on('sendMessage', (chatId, message) => {
        const chatFilePath = path.join(__dirname, 'chats', `${chatId}.json`);
        const chatData = fs.existsSync(chatFilePath) ? JSON.parse(fs.readFileSync(chatFilePath, 'utf8')) : [];

        // Add new message to chat data
        chatData.push({ username: socket.user.username, message, timestamp: new Date().toISOString() });
        fs.writeFileSync(chatFilePath, JSON.stringify(chatData, null, 2));

        // Broadcast message to chat room
        io.to(chatId).emit('newMessage', { username: socket.user.username, message, timestamp: new Date().toISOString() });
    });
});

// Start the server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
