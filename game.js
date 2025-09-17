// Game client for Mini MMORPG
class GameClient {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.worldImage = null;
        this.worldWidth = 2048;
        this.worldHeight = 2048;
        
        // Game state
        this.players = {};
        this.avatars = {};
        this.myPlayerId = null;
        this.myPlayer = null;
        
        // Image cache for avatars
        this.avatarImageCache = {};
        
        // WebSocket connection
        this.socket = null;
        this.serverUrl = 'wss://codepath-mmorg.onrender.com';
        
        // Camera/viewport
        this.cameraX = 0;
        this.cameraY = 0;
        
        // Movement
        this.isMoving = false;
        this.targetX = null;
        this.targetY = null;
        this.movementSpeed = 100; // pixels per second
        
        // Key state tracking
        this.pressedKeys = new Set();
        this.movementTimer = null;
        this.movementInterval = 100; // Send move command every 100ms
        this.lastDirection = null; // Track last direction for diagonal movement
        
        // Local position tracking for smooth UI updates
        this.localPlayerX = 0;
        this.localPlayerY = 0;
        this.lastServerUpdate = 0;
        this.lastLocalUpdate = 0;
        
        this.init();
        this.setupUI();
    }
    
    init() {
        this.setupCanvas();
        this.loadWorldMap();
        this.connectToServer();
        this.setupControls();
    }
    
    setupCanvas() {
        // Set canvas size to fill the browser window
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.draw();
        });
    }
    
    loadWorldMap() {
        this.worldImage = new Image();
        this.worldImage.onload = () => {
            this.draw();
        };
        this.worldImage.src = 'world.jpg';
    }
    
    setupControls() {
        // Keyboard controls
        document.addEventListener('keydown', (event) => {
            this.handleKeyDown(event);
        });
        
        document.addEventListener('keyup', (event) => {
            this.handleKeyUp(event);
        });
        
        // Click-to-move
        this.canvas.addEventListener('click', (event) => {
            this.handleCanvasClick(event);
        });
        
        // Start game loop
        this.gameLoop();
    }
    
    setupUI() {
        // Get UI elements
        this.statusDot = document.querySelector('.status-dot');
        this.statusText = document.querySelector('.status-text');
        this.playerName = document.getElementById('player-name');
        this.playerPosition = document.getElementById('player-position');
        this.playerCount = document.getElementById('player-count');
        this.playersList = document.getElementById('players-ul');
    }
    
    handleKeyDown(event) {
        if (!this.myPlayer || !this.socket) return;
        
        const key = event.key.toLowerCase();
        
        // Check if this is a movement key
        const movementKeys = ['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
        if (!movementKeys.includes(key)) return;
        
        // Prevent default behavior (scrolling, etc.)
        event.preventDefault();
        
        // Only process if this key wasn't already pressed
        if (!this.pressedKeys.has(key)) {
            this.pressedKeys.add(key);
            
            // Start movement timer if not already running
            if (!this.movementTimer) {
                this.startMovementTimer();
            }
        }
    }
    
    handleKeyUp(event) {
        const key = event.key.toLowerCase();
        
        // Remove key from pressed keys set
        this.pressedKeys.delete(key);
        
        // Stop movement timer if no keys are pressed
        if (this.pressedKeys.size === 0) {
            this.stopMovementTimer();
        }
    }
    
    handleCanvasClick(event) {
        if (!this.myPlayer || !this.socket) return;
        
        // Get click position relative to canvas
        const rect = this.canvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        
        // Convert screen coordinates to world coordinates
        const worldX = clickX + this.cameraX;
        const worldY = clickY + this.cameraY;
        
        // Clamp to world boundaries
        const clampedX = Math.max(0, Math.min(worldX, this.worldWidth));
        const clampedY = Math.max(0, Math.min(worldY, this.worldHeight));
        
        // Update local position immediately for click-to-move
        this.localPlayerX = clampedX;
        this.localPlayerY = clampedY;
        this.lastLocalUpdate = Date.now();
        this.updatePlayerInfo();
        
        this.sendMoveTo(clampedX, clampedY);
    }
    
    sendMovement(direction) {
        const message = {
            action: 'move',
            direction: direction
        };
        console.log('Sending movement:', message);
        this.socket.send(JSON.stringify(message));
    }
    
    sendMoveTo(x, y) {
        const message = {
            action: 'move',
            x: Math.round(x),
            y: Math.round(y)
        };
        this.socket.send(JSON.stringify(message));
    }
    
    sendStop() {
        const message = {
            action: 'stop'
        };
        this.socket.send(JSON.stringify(message));
    }
    
    updateLocalPosition(direction) {
        if (!this.myPlayer) return;
        
        const moveDistance = 32; // Move distance per command (adjust as needed)
        
        switch (direction) {
            case 'up':
                this.localPlayerY = Math.max(0, this.localPlayerY - moveDistance);
                break;
            case 'down':
                this.localPlayerY = Math.min(this.worldHeight, this.localPlayerY + moveDistance);
                break;
            case 'left':
                this.localPlayerX = Math.max(0, this.localPlayerX - moveDistance);
                break;
            case 'right':
                this.localPlayerX = Math.min(this.worldWidth, this.localPlayerX + moveDistance);
                break;
        }
        
        // Track when we last updated locally
        this.lastLocalUpdate = Date.now();
        
        // Update UI immediately
        this.updatePlayerInfo();
    }
    
    startMovementTimer() {
        if (this.movementTimer) return; // Already running
        
        this.movementTimer = setInterval(() => {
            this.sendCurrentMovement();
        }, this.movementInterval);
    }
    
    stopMovementTimer() {
        if (this.movementTimer) {
            clearInterval(this.movementTimer);
            this.movementTimer = null;
        }
    }
    
    sendCurrentMovement() {
        if (!this.myPlayer || !this.socket || this.pressedKeys.size === 0) return;
        
        // Check for diagonal movement combinations
        const keys = Array.from(this.pressedKeys);
        let direction = null;
        
        // Check for diagonal combinations first
        if (keys.includes('w') || keys.includes('arrowup')) {
            if (keys.includes('d') || keys.includes('arrowright')) {
                // Diagonal up-right: alternate between up and right
                direction = this.lastDirection === 'up' ? 'right' : 'up';
            } else if (keys.includes('a') || keys.includes('arrowleft')) {
                // Diagonal up-left: alternate between up and left
                direction = this.lastDirection === 'up' ? 'left' : 'up';
            } else {
                direction = 'up';
            }
        } else if (keys.includes('s') || keys.includes('arrowdown')) {
            if (keys.includes('d') || keys.includes('arrowright')) {
                // Diagonal down-right: alternate between down and right
                direction = this.lastDirection === 'down' ? 'right' : 'down';
            } else if (keys.includes('a') || keys.includes('arrowleft')) {
                // Diagonal down-left: alternate between down and left
                direction = this.lastDirection === 'down' ? 'left' : 'down';
            } else {
                direction = 'down';
            }
        } else if (keys.includes('a') || keys.includes('arrowleft')) {
            direction = 'left';
        } else if (keys.includes('d') || keys.includes('arrowright')) {
            direction = 'right';
        }
        
        if (direction) {
            this.lastDirection = direction;
            this.updateLocalPosition(direction);
            this.sendMovement(direction);
        }
    }
    
    gameLoop() {
        // Update game state
        this.update();
        
        // Draw everything
        this.draw();
        
        // Continue loop
        requestAnimationFrame(() => this.gameLoop());
    }
    
    update() {
        // Update camera position continuously
        if (this.myPlayer) {
            this.updateCameraPosition();
            this.updatePlayerInfo();
        }
    }
    
    connectToServer() {
        this.socket = new WebSocket(this.serverUrl);
        
        this.socket.onopen = () => {
            console.log('Connected to game server');
            this.updateConnectionStatus(true);
            this.joinGame();
        };
        
        this.socket.onmessage = (event) => {
            this.handleServerMessage(JSON.parse(event.data));
        };
        
        this.socket.onclose = () => {
            console.log('Disconnected from game server');
            this.updateConnectionStatus(false);
        };
        
        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateConnectionStatus(false);
        };
    }
    
    joinGame() {
        const joinMessage = {
            action: 'join_game',
            username: 'Teja'
        };
        
        this.socket.send(JSON.stringify(joinMessage));
    }
    
    handleServerMessage(message) {
        console.log('Received message:', message);
        
        switch (message.action) {
            case 'join_game':
                if (message.success) {
                    this.myPlayerId = message.playerId;
                    this.players = message.players;
                    this.avatars = message.avatars;
                    this.myPlayer = this.players[this.myPlayerId];
                    
                    // Initialize local position tracking
                    this.localPlayerX = this.myPlayer.x;
                    this.localPlayerY = this.myPlayer.y;
                    this.lastServerUpdate = Date.now();
                    
                    console.log('My player ID:', this.myPlayerId);
                    console.log('My player data:', this.myPlayer);
                    console.log('Available avatars:', Object.keys(this.avatars));
                    console.log('Spawn position:', this.myPlayer.x, this.myPlayer.y);
                    
                    // Cache all avatar images
                    Object.values(message.avatars).forEach(avatar => {
                        this.cacheAvatarImages(avatar);
                    });
                    
                    this.updateCameraPosition();
                    this.updatePlayerInfo();
                    this.updatePlayersList();
                } else {
                    console.error('Failed to join game:', message.error);
                }
                break;
                
            case 'player_joined':
                this.players[message.player.id] = message.player;
                this.avatars[message.avatar.name] = message.avatar;
                this.cacheAvatarImages(message.avatar);
                this.updatePlayersList();
                break;
                
            case 'players_moved':
                console.log('Received players_moved:', message.players);
                Object.assign(this.players, message.players);
                
                // Don't update local position from server - keep using local position for UI
                // Server position is still used for camera and other players
                console.log('Ignoring server position update for UI, keeping local position');
                
                console.log('My player after update:', this.myPlayer);
                console.log('All players:', this.players);
                this.updateCameraPosition();
                this.updatePlayerInfo();
                break;
                
            case 'player_left':
                delete this.players[message.playerId];
                this.updatePlayersList();
                break;
        }
    }
    
    cacheAvatarImages(avatar) {
        const avatarName = avatar.name;
        if (!this.avatarImageCache[avatarName]) {
            this.avatarImageCache[avatarName] = {};
        }
        
        // Cache images for each direction and frame
        Object.keys(avatar.frames).forEach(direction => {
            if (!this.avatarImageCache[avatarName][direction]) {
                this.avatarImageCache[avatarName][direction] = {};
            }
            
            avatar.frames[direction].forEach((frameData, frameIndex) => {
                if (!this.avatarImageCache[avatarName][direction][frameIndex]) {
                    const img = new Image();
                    img.onload = () => {
                        console.log('Loaded image for:', avatarName, direction, frameIndex);
                    };
                    img.src = frameData;
                    this.avatarImageCache[avatarName][direction][frameIndex] = img;
                }
            });
        });
    }
    
    updateCameraPosition() {
        if (this.myPlayer) {
            // Use local position for camera to follow smooth movement
            const playerX = this.localPlayerX || this.myPlayer.x;
            const playerY = this.localPlayerY || this.myPlayer.y;
            
            // Center camera on player, but clamp to map boundaries
            const newCameraX = Math.max(0, Math.min(
                playerX - this.canvas.width / 2,
                this.worldWidth - this.canvas.width
            ));
            const newCameraY = Math.max(0, Math.min(
                playerY - this.canvas.height / 2,
                this.worldHeight - this.canvas.height
            ));
            
            // Always update camera position
            this.cameraX = newCameraX;
            this.cameraY = newCameraY;
            
            console.log('Camera updated:', this.cameraX, this.cameraY, 'Player:', playerX, playerY);
        }
    }
    
    draw() {
        if (!this.worldImage) return;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw world map portion based on camera position (actual size, no scaling)
        this.ctx.drawImage(
            this.worldImage,
            this.cameraX, this.cameraY, this.canvas.width, this.canvas.height,
            0, 0, this.canvas.width, this.canvas.height
        );
        
        // Draw all players
        this.drawPlayers();
    }
    
    drawPlayers() {
        Object.values(this.players).forEach(player => {
            this.drawPlayer(player);
        });
    }
    
    drawPlayer(player) {
        const avatar = this.avatars[player.avatar];
        if (!avatar) {
            console.log('No avatar found for player:', player.username, 'avatar name:', player.avatar);
            return;
        }
        
        // Convert world coordinates to screen coordinates
        const screenX = player.x - this.cameraX;
        const screenY = player.y - this.cameraY;
        
        // Only draw if player is visible on screen
        if (screenX < -50 || screenX > this.canvas.width + 50 || 
            screenY < -50 || screenY > this.canvas.height + 50) {
            return;
        }
        
        // Get the appropriate avatar frame
        const direction = player.facing || 'south';
        const frameIndex = player.animationFrame || 0;
        
        // Get cached image
        let img = this.avatarImageCache[player.avatar]?.[direction]?.[frameIndex];
        
        // If no cached image or not loaded, create and cache it
        if (!img || !img.complete || img.naturalWidth === 0) {
            const avatar = this.avatars[player.avatar];
            const frames = avatar.frames[direction];
            if (frames && frames[frameIndex]) {
                img = new Image();
                img.onload = () => {
                    // Image loaded successfully
                };
                img.src = frames[frameIndex];
                
                // Cache it for future use
                if (!this.avatarImageCache[player.avatar]) {
                    this.avatarImageCache[player.avatar] = {};
                }
                if (!this.avatarImageCache[player.avatar][direction]) {
                    this.avatarImageCache[player.avatar][direction] = {};
                }
                this.avatarImageCache[player.avatar][direction][frameIndex] = img;
                
                console.log('Creating new image for:', player.avatar, direction, frameIndex);
                
                // Draw fallback rectangle while image loads
                this.drawFallbackAvatar(player, screenX, screenY);
                return;
            } else {
                console.log('No image data available for:', player.avatar, direction, frameIndex);
                this.drawFallbackAvatar(player, screenX, screenY);
                return;
            }
        }
        
        // Draw avatar maintaining aspect ratio
        const avatarSize = 32; // Base size
        const aspectRatio = img.width / img.height;
        const width = avatarSize * aspectRatio;
        const height = avatarSize;
        
        try {
            this.ctx.drawImage(
                img,
                screenX - width / 2,
                screenY - height,
                width,
                height
            );
        } catch (error) {
            console.log('Error drawing avatar image:', error);
            // Fallback: draw a colored rectangle
            this.ctx.fillStyle = player.id === this.myPlayerId ? 'blue' : 'green';
            this.ctx.fillRect(
                screenX - width / 2,
                screenY - height,
                width,
                height
            );
        }
        
        // Draw username label
        this.ctx.fillStyle = 'white';
        this.ctx.strokeStyle = 'black';
        this.ctx.lineWidth = 2;
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        
        const textX = screenX;
        const textY = screenY - height - 5;
        
        // Draw text outline
        this.ctx.strokeText(player.username, textX, textY);
        // Draw text fill
        this.ctx.fillText(player.username, textX, textY);
        
        // Debug: Draw a small colored dot to show player position
        if (player.id === this.myPlayerId) {
            this.ctx.fillStyle = 'red';
            this.ctx.fillRect(screenX - 2, screenY - 2, 4, 4);
        }
    }
    
    drawFallbackAvatar(player, screenX, screenY) {
        const avatarSize = 32;
        const width = avatarSize;
        const height = avatarSize;
        
        // Draw colored rectangle as fallback
        this.ctx.fillStyle = player.id === this.myPlayerId ? 'blue' : 'green';
        this.ctx.fillRect(
            screenX - width / 2,
            screenY - height,
            width,
            height
        );
        
        // Draw username label
        this.ctx.fillStyle = 'white';
        this.ctx.strokeStyle = 'black';
        this.ctx.lineWidth = 2;
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        
        const textX = screenX;
        const textY = screenY - height - 5;
        
        // Draw text outline
        this.ctx.strokeText(player.username, textX, textY);
        // Draw text fill
        this.ctx.fillText(player.username, textX, textY);
        
        // Debug: Draw a small colored dot to show player position
        if (player.id === this.myPlayerId) {
            this.ctx.fillStyle = 'red';
            this.ctx.fillRect(screenX - 2, screenY - 2, 4, 4);
        }
    }
    
    // UI Update Methods
    updateConnectionStatus(connected) {
        if (connected) {
            this.statusDot.classList.add('connected');
            this.statusText.textContent = 'Connected';
        } else {
            this.statusDot.classList.remove('connected');
            this.statusText.textContent = 'Disconnected';
        }
    }
    
    updatePlayerInfo() {
        if (this.myPlayer) {
            this.playerName.textContent = this.myPlayer.username;
            
            // Use local position for smoother updates, fallback to server position
            const displayX = this.localPlayerX || this.myPlayer.x;
            const displayY = this.localPlayerY || this.myPlayer.y;
            this.playerPosition.textContent = `${Math.round(displayX)}, ${Math.round(displayY)}`;
        }
    }
    
    updatePlayersList() {
        const players = Object.values(this.players);
        this.playerCount.textContent = players.length;
        
        // Clear and rebuild player list
        this.playersList.innerHTML = '';
        
        // Add real players
        players.forEach(player => {
            const li = document.createElement('li');
            li.textContent = `${player.username} (${Math.round(player.x)}, ${Math.round(player.y)})`;
            if (player.id === this.myPlayerId) {
                li.style.color = '#74c0fc';
                li.style.fontWeight = 'bold';
            }
            this.playersList.appendChild(li);
        });
        
        // Add some test players to demonstrate scrolling (remove this later)
        if (players.length < 8) {
            const testPlayers = [
                'TestPlayer1', 'TestPlayer2', 'TestPlayer3', 'TestPlayer4',
                'TestPlayer5', 'TestPlayer6', 'TestPlayer7', 'TestPlayer8'
            ];
            
            for (let i = players.length; i < 8; i++) {
                const li = document.createElement('li');
                li.textContent = `${testPlayers[i]} (${Math.floor(Math.random() * 2000)}, ${Math.floor(Math.random() * 2000)})`;
                li.style.color = '#adb5bd';
                this.playersList.appendChild(li);
            }
        }
    }
}

// Initialize the game when the page loads
window.addEventListener('load', () => {
    new GameClient();
});
