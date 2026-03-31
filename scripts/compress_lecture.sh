#!/bin/bash

# Check if a filename was provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <video_file>"
    exit 1
fi

input="$1"

# Check if the file exists
if [ ! -f "$input" ]; then
    echo "Error: File '$input' not found."
    exit 1
fi

# Build output filename: basename + "_compressed.mp4"
basename="${input%.*}"
output="${basename}_compressed.mp4"

# Run ffmpeg with your compression settings
ffmpeg -i "$input" \
    -c:v libx264 -crf 35 -preset fast \
    -vf "scale=640:-2,fps=15" \
    -c:a aac -b:a 32k -ac 1 \
    -y "$output"

echo "Compressed video saved as: $output"
