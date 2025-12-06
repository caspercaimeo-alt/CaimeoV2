#!/bin/bash
set -e

echo "🚀 CAIMEO Installer Starting..."
echo ""

# ======================================
# 1. CHECK PYTHON
# ======================================
if ! command -v python3 &> /dev/null
then
    echo "❌ Python3 is not installed. Install Python 3.8+ first."
    exit 1
fi

# ======================================
# 2. CREATE VIRTUAL ENVIRONMENT
# ======================================
echo "📦 Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

# ======================================
# 3. INSTALL PYTHON DEPENDENCIES
# ======================================
echo "📥 Installing Python dependencies..."
pip install --upgrade pip

pip install fastapi uvicorn alpaca-trade-api pandas requests yfinance beautifulsoup4 python-multipart

echo "✅ Python packages installed."

# ======================================
# 4. CHECK NODE / NPM
# ======================================
if ! command -v npm &> /dev/null
then
    echo "❌ Node.js and npm not detected."
    echo "➡ Install Node.js from https://nodejs.org/en/download"
    exit 1
fi

# ======================================
# 5. INSTALL FRONTEND DEPENDENCIES
# ======================================
echo ""
echo "📥 Installing React frontend dependencies..."
cd alpaca-ui
npm install
cd ..

echo "✅ Frontend installed."

# ======================================
# 6. START BACKEND
# ======================================
echo ""
echo "🟢 Starting CAIMEO backend server..."
nohup uvicorn server:app --host 0.0.0.0 --port 8000 --reload > backend.log 2>&1 &

sleep 2

# ======================================
# 7. START FRONTEND
# ======================================
echo ""
echo "🟢 Starting CAIMEO frontend..."
cd alpaca-ui
nohup npm start > frontend.log 2>&1 &

echo ""
echo "🎉 CAIMEO Is Running!"
echo "➡ Backend: http://localhost:8000"
echo "➡ Frontend: http://localhost:3000"
echo ""
echo "Logs saved to backend.log and frontend.log"
