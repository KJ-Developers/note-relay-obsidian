# Note Relay

**Access your Obsidian vault from anywhere** • Zero-knowledge privacy • Open source

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-7.1.0-blue.svg)](https://github.com/KJ-Developers/note-relay-plugin/releases)

---

## 🎯 What is Note Relay?

Note Relay transforms your Obsidian vault into a remotely accessible workspace while maintaining **zero-knowledge privacy**. Your notes stay on your device, connections are peer-to-peer, and only **you** control access.

### Key Features

- 🌐 **Remote Access** - Browse and edit your vault from any browser
- 🔒 **Zero-Knowledge** - Your data never touches our servers
- 🔄 **Real-time Sync** - Changes sync instantly via WebRTC
- 🎨 **Full Rendering** - Dataview, callouts, math, graphs—all work
- 👥 **Guest Sharing** - Share vaults with read-only or full access (Pro)
- 📱 **Mobile Friendly** - Works on phone, tablet, desktop

---

## 🚀 Quick Start

### Installation

#### From Obsidian Community Plugins (Coming Soon)
1. Open Obsidian → Settings → Community Plugins
2. Search for "Note Relay"
3. Click Install → Enable

#### Manual Installation
1. Download latest release from [GitHub Releases](https://github.com/KJ-Developers/note-relay-plugin/releases)
2. Extract to: `.obsidian/plugins/note-relay-plugin/`
3. Enable in Obsidian Settings → Community Plugins

### Usage

1. **Start the server**
   - Command Palette: `Note Relay: Start Server`
   - Or click "Start Server" in plugin settings

2. **Access locally**
   - Visit `http://localhost:5474` in any browser
   - Same machine, no internet required

3. **Access remotely** (requires subscription)
   - Enable remote mode in settings
   - Access from anywhere via your custom URL

---

## 💰 Pricing

| Feature | **Free** | **Base ($1.99/mo)** | **Pro ($3.99/mo)** |
|---------|----------|---------------------|-------------------|
| **Local Access** | ✅ Unlimited | ✅ Unlimited | ✅ Unlimited |
| **Remote Access** | ❌ | ✅ Anywhere | ✅ Anywhere |
| **Guest Sharing** | ❌ | ❌ | ✅ Unlimited |
| **Audit Logs** | ❌ | ❌ | ✅ Local logs |
| **Support** | Community | Email | Priority |

**All tiers:** Unlimited devices • Zero-knowledge • Your data stays local

[Subscribe at noterelay.io](https://noterelay.io)

---

## 🏗️ Architecture

This is a monorepo containing:

```
note-relay-plugin/
├── plugin/          # Obsidian plugin
│   ├── src/        # Express server + WebRTC
│   └── main.js     # Built bundle
├── ui/             # Web interface
│   ├── src/        # Modular UI (17 files)
│   └── dist/       # Built bundle
├── docs/           # Documentation
└── scripts/        # Build automation
```

### How It Works

1. **Plugin** runs an Express server on `localhost:5474`
2. **UI** connects via HTTP (local) or WebRTC (remote)
3. **Commands** sent as JSON messages
4. **Responses** include rendered HTML + graph data
5. **Remote** uses Supabase for signaling only (zero-knowledge)

---

## 🔧 Development

### Prerequisites

- Node.js 18+
- npm 9+
- Obsidian 1.4+

### Build from Source

```bash
# Clone repo
git clone https://github.com/KJ-Developers/note-relay-plugin.git
cd note-relay-plugin

# Install dependencies
npm install

# Build everything
npm run build

# Or build individually
npm run build:ui      # UI bundle only
npm run build:plugin  # Plugin only

# Development mode
npm run dev:ui        # UI with hot reload
npm run dev:plugin    # Plugin with watch mode
```

### Project Structure

- **`plugin/src/source.js`** - Express server, WebRTC, Obsidian API
- **`ui/src/core/app.js`** - Main UI controller
- **`ui/src/core/connection.js`** - VaultConnection class (HTTP + WebRTC)
- **`ui/src/styles/main.css`** - All CSS (927 lines)

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make changes and test thoroughly
4. Commit: `git commit -m 'Add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Open a Pull Request

### Code Style

- **JavaScript**: ES6+ with async/await
- **Formatting**: 2 spaces, semicolons
- **Comments**: JSDoc for functions
- **Commits**: Conventional Commits format

---

## 🔐 Security

Note Relay uses **zero-knowledge architecture**:

- ✅ Your vault data stays on your device
- ✅ Passwords hashed with SHA-256 (client-side)
- ✅ WebRTC peer-to-peer (no server relay for data)
- ✅ Supabase only used for signaling (connection setup)
- ✅ No analytics, no tracking, no data collection

**Server-side protection:**
- License validation via Stripe webhooks
- Guest access controlled via database
- JWT tokens for authentication
- Rate limiting and abuse prevention

**Client-side features** (local mode):
- Connection limits are intentionally **not enforced**
- Local = your network, your rules
- Remote mode enforces limits via server validation

See [SECURITY.md](docs/SECURITY.md) for details.

---

## 📚 Documentation

- [Setup Guide](docs/SETUP_GUIDE.md) - Detailed installation and configuration
- [Architecture](docs/ARCHITECTURE.md) - System design and technical details
- [Security Model](docs/SECURITY.md) - How we protect your data
- [API Reference](docs/API.md) - Message protocol and commands
- [Contributing](docs/CONTRIBUTING.md) - Development guidelines

---

## 🐛 Support

- **Issues**: [GitHub Issues](https://github.com/KJ-Developers/note-relay-plugin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/KJ-Developers/note-relay-plugin/discussions)
- **Email**: support@noterelay.io
- **Discord**: [Join our community](https://discord.gg/noterelay)

---

## 📝 License

This project is licensed under the **MIT License** - see [LICENSE](LICENSE) file for details.

**What this means:**
- ✅ Use commercially
- ✅ Modify and distribute
- ✅ Private use
- ✅ No warranty or liability

---

## 🙏 Acknowledgments

Built with:
- [Obsidian](https://obsidian.md) - Knowledge management platform
- [Express](https://expressjs.com) - Web server
- [SimplePeer](https://github.com/feross/simple-peer) - WebRTC wrapper
- [Supabase](https://supabase.com) - Signaling backend
- [Vite](https://vitejs.dev) - UI bundler
- [Marked](https://marked.js.org) - Markdown parser
- [EasyMDE](https://easymde.tk) - Markdown editor
- [Prism](https://prismjs.com) - Syntax highlighting

---

## 🌟 Star History

If you find Note Relay useful, please consider starring the repo! ⭐

---

**Made with ❤️ by [KJ-Developers](https://github.com/KJ-Developers)**
