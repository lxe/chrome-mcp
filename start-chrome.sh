#!/bin/bash

# Function to detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)
            if grep -qi microsoft /proc/version; then
                echo "WSL"
            else
                echo "Linux"
            fi
            ;;
        Darwin*)
            echo "MacOS"
            ;;
        *)
            echo "Unknown"
            ;;
    esac
}

# Function to find Chrome executable
find_chrome() {
    local os=$1
    case $os in
        "WSL")
            echo "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
            ;;
        "Linux")
            if command -v google-chrome >/dev/null 2>&1; then
                echo "google-chrome"
            else
                echo "Chrome not found. Please install Google Chrome."
                exit 1
            fi
            ;;
        "MacOS")
            if [ -d "/Applications/Google Chrome.app" ]; then
                echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            else
                echo "Chrome not found. Please install Google Chrome."
                exit 1
            fi
            ;;
        *)
            echo "Unsupported operating system"
            exit 1
            ;;
    esac
}

# Main script
OS=$(detect_os)
CHROME=$(find_chrome "$OS")
DEBUG_PORT=9222

echo "Detected OS: $OS"
echo "Using Chrome: $CHROME"

# Start Chrome with debugging enabled
"$CHROME" --remote-debugging-port=$DEBUG_PORT &

echo "Chrome started with debugging enabled on port $DEBUG_PORT" 