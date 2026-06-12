#!/bin/bash
# Fix symlinks for NTFS filesystem - replace pnpm symlinks with real copies
# NTFS doesn't handle pnpm symlinks correctly, causing "Module not found" errors

cd "$(dirname "$0")/.."

# Only run if we're on a filesystem that doesn't support symlinks well
# Check for common NTFS mount points
if df -T node_modules 2>/dev/null | grep -qi 'ntfs\|fuse' || [ "$CI" = "true" ]; then
    echo "Fixing symlinks in node_modules/@radix-ui/..."
    
    for pkg in node_modules/@radix-ui/*; do
        if [ -L "$pkg" ]; then
            target=$(readlink "$pkg")
            abs_target="$(cd "$(dirname "$pkg")" && cd "$(dirname "$target")" && pwd)/$(basename "$target")"
            rm "$pkg"
            cp -r "$abs_target" "$pkg"
            echo "  Fixed: $(basename $pkg)"
        fi
    done
    
    # Also fix other known problematic packages
    for dir in node_modules/cmdk node_modules/@floating-ui; do
        if [ -d "$dir" ]; then
            for pkg in "$dir"/*; do
                if [ -L "$pkg" ]; then
                    target=$(readlink "$pkg")
                    abs_target="$(cd "$(dirname "$pkg")" && cd "$(dirname "$target")" && pwd)/$(basename "$target")"
                    rm "$pkg"
                    cp -r "$abs_target" "$pkg"
                    echo "  Fixed: $(basename $pkg)"
                fi
            done
        fi
    done
    
    echo "Symlink fix complete!"
fi
