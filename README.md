# WLED Video Wall Sync Engine 🚀

A high-performance full-stack tool for syncing real-time videos, webcam feeds, procedural shaders, and NDI/RTSP streams to WLED matrixes, strips, and spotlight/accent ambient lights.

---

## 💻 How to Update and Run on your Local PC (Linux / Pop!_OS)

Follow these steps to run the application on your computer using Git and the Terminal:

### 1. Retrieve or Clone the Repository
If you haven't cloned the project yet, open your terminal and run:
```bash
git clone https://github.com/your-username/WledWALL.git
cd WledWALL
```

If you have already cloned the repository and want to **update to the latest version**:
```bash
# Save any active local files (optional)
git stash

# Fetch and merge the latest codebase changes
git pull origin main

# Re-apply any local changes (optional)
git stash pop
```

### 2. Install Node.js (Prerequisites)
Make sure Node.js (version 18+) and npm are installed. On Pop!_OS / Ubuntu / Debian, run:
```bash
sudo apt update
sudo apt install nodejs npm
```

### 3. Install NPM Packages & Launch the App
Inside your project folder `WledWALL`, install packages and run the development server:
```bash
# Install required Node/React dependencies
npm install

# Start the application dev server (runs on Port 3000)
npm run dev
```
Open your browser and navigate to: **`http://localhost:3000`**

---

## 🐍 Python Stream Receivers (0-Latency PipeWire / GStreamer RTSP)

If you are running the zero-latency PipeWire tab or GStreamer pipelines, make sure to resolve missing dependencies (e.g. PIL/Pillow):

### 1. Install System GStreamer & Python Cairo Bindings
```bash
sudo apt update
sudo apt install python3-gi python3-gi-cairo gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-pipewire
```

### 2. Install Pillow (PIL) and Requests
On Pop!_OS and Ubuntu, standard system pip packages might be managed externally. Install them using `--break-system-packages` to bypass the environmental blocks:
```bash
python3 -m pip install pillow requests --break-system-packages
```

### 3. Run Your Streamer
- **For PipeWire (0-latency screen capture):**
  ```bash
  python3 pw_matrix_sink.py
  ```
- **For RTSP GStreamer (IP cameras):**
  ```bash
  python3 gst_rtsp_receiver.py
  ```

---

## 🎯 Precise Spot Mapping (Spotlight Controls)
Use the **Individual Accent Lamp** mapping module in the sidebar to sync WLED bulbs/spotlights:
- Toggle **Precise Coordinates** to visually position a target single pixel or area-average box.
- Drag the sliders to see the live target outline move on the video matrix preview canvas in real time!
