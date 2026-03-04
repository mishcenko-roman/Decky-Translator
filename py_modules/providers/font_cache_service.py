import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import urllib.parse
from datetime import datetime
from pathlib import Path

import requests


class FontCacheService:
    def __init__(self, logger, settings_dir: str):
        self._logger = logger
        runtime_dir = os.environ.get(
            "DECKY_PLUGIN_RUNTIME_DIR",
            os.path.join(settings_dir, "..", "data", "decky-translator")
        )
        self._font_cache_dir = os.path.join(runtime_dir, "font_cache")

    def initialize(self):
        os.makedirs(self._font_cache_dir, exist_ok=True)
        self._logger.info(f"Font cache directory: {self._font_cache_dir}")

    def _font_dir(self, font_name: str) -> str:
        safe = re.sub(r'[^\w\-]', '_', font_name)
        return os.path.join(self._font_cache_dir, safe)

    @staticmethod
    def _detect_font_mime(url: str):
        if '.woff2' in url:
            return '.woff2', 'font/woff2'
        if '.woff' in url and '.woff2' not in url:
            return '.woff', 'font/woff'
        if '.ttf' in url:
            return '.ttf', 'font/ttf'
        if '.otf' in url:
            return '.otf', 'font/otf'
        return '.woff2', 'font/woff2'

    def _cache_font_sync(self, font_name: str, css_urls: list) -> dict:
        """Download font CSS + referenced font files and store on disk."""
        try:
            font_dir = self._font_dir(font_name)
            os.makedirs(font_dir, exist_ok=True)

            headers = {
                'User-Agent': (
                    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                )
            }

            all_css_parts = []
            total_files = 0
            url_re = re.compile(r'url\(([^)]+)\)')

            def _make_url_replacer(css_url_: str):
                """Return a re.sub replacer that resolves URLs relative to css_url_.

                Defined as a factory to avoid the classic Python loop-closure bug:
                a plain nested function would capture `css_url` by reference and
                always see the *last* value of the loop variable.
                """
                def _replace_url(m):
                    nonlocal total_files
                    raw = m.group(1).strip().strip('"').strip("'")
                    if raw.startswith('data:'):
                        return m.group(0)
                    absolute_url = urllib.parse.urljoin(css_url_, raw)
                    ext, mime = self._detect_font_mime(absolute_url)
                    fname = hashlib.md5(absolute_url.encode()).hexdigest() + ext
                    fpath = os.path.join(font_dir, fname)
                    if not os.path.exists(fpath):
                        font_resp = requests.get(absolute_url, headers=headers, timeout=30)
                        font_resp.raise_for_status()
                        with open(fpath, 'wb') as f:
                            f.write(font_resp.content)
                        total_files += 1
                    with open(fpath, 'rb') as f:
                        b64 = base64.b64encode(f.read()).decode('ascii')
                    return f'url(data:{mime};base64,{b64})'
                return _replace_url

            for css_url in css_urls:
                resp = requests.get(css_url, headers=headers, timeout=15)
                resp.raise_for_status()
                css_text = resp.text
                modified_css = url_re.sub(_make_url_replacer(css_url), css_text)
                all_css_parts.append(modified_css)

            combined_css = '\n'.join(all_css_parts)

            # Write both files atomically via a temp-file + os.replace pattern so
            # that a mid-write failure (disk full, power loss) never leaves the
            # cache directory in an inconsistent state where one file exists but
            # the other doesn't.
            css_path = os.path.join(font_dir, 'cached.css')
            css_tmp = css_path + '.tmp'
            with open(css_tmp, 'w') as f:
                f.write(combined_css)
            os.replace(css_tmp, css_path)

            meta = {
                'font_name': font_name,
                'css_urls': css_urls,
                'cached_at': datetime.now().isoformat(),
                'file_count': total_files,
                'css_size': len(combined_css),
            }
            meta_path = os.path.join(font_dir, 'meta.json')
            meta_tmp = meta_path + '.tmp'
            with open(meta_tmp, 'w') as f:
                json.dump(meta, f)
            os.replace(meta_tmp, meta_path)

            self._logger.info(
                f"Cached font '{font_name}': {total_files} new files, {len(combined_css)} bytes CSS"
            )
            return {'success': True, 'fileCount': total_files, 'cssSize': len(combined_css)}
        except Exception as e:
            self._logger.error(f"Failed to cache font '{font_name}': {e}")
            return {'success': False, 'error': str(e)}

    async def cache_font(self, font_name: str, css_urls: list) -> dict:
        return await asyncio.to_thread(self._cache_font_sync, font_name, css_urls)

    def _get_cached_font_css_sync(self, font_name: str) -> str:
        """Return CSS with embedded data-URIs, or empty string."""
        try:
            css_path = os.path.join(self._font_dir(font_name), 'cached.css')
            if os.path.exists(css_path):
                with open(css_path, 'r') as f:
                    return f.read()
        except Exception as e:
            self._logger.error(f"Failed to read cached font '{font_name}': {e}")
        return ""

    async def get_cached_font_css(self, font_name: str) -> str:
        return await asyncio.to_thread(self._get_cached_font_css_sync, font_name)

    async def is_font_cached(self, font_name: str) -> bool:
        """Check whether a font has been cached to disk.

        Delegates the os.path.exists call to the thread pool to stay consistent
        with all other async methods in this class and avoid blocking the event
        loop, even though the stat syscall is typically fast.
        """
        path = os.path.join(self._font_dir(font_name), 'cached.css')
        return await asyncio.to_thread(os.path.exists, path)

    def _get_font_cache_info_sync(self) -> dict:
        """Return cache statistics."""
        if not os.path.exists(self._font_cache_dir):
            return {'totalFonts': 0, 'totalSizeBytes': 0, 'fonts': []}

        fonts = []
        total_size = 0
        for entry in os.scandir(self._font_cache_dir):
            if not entry.is_dir():
                continue
            meta_path = os.path.join(entry.path, 'meta.json')
            if not os.path.exists(meta_path):
                continue
            with open(meta_path, 'r') as f:
                meta = json.load(f)
            dir_size = sum(
                p.stat().st_size for p in Path(entry.path).rglob('*') if p.is_file()
            )
            total_size += dir_size
            fonts.append({
                'name': meta.get('font_name', entry.name),
                'cachedAt': meta.get('cached_at', ''),
                'sizeBytes': dir_size,
            })
        return {'totalFonts': len(fonts), 'totalSizeBytes': total_size, 'fonts': fonts}

    async def get_font_cache_info(self) -> dict:
        return await asyncio.to_thread(self._get_font_cache_info_sync)

    def _get_cached_font_names_sync(self) -> list:
        """Return list of cached font names (lightweight, no size calculation)."""
        if not os.path.exists(self._font_cache_dir):
            return []

        names = []
        for entry in os.scandir(self._font_cache_dir):
            if not entry.is_dir():
                continue
            meta_path = os.path.join(entry.path, 'meta.json')
            if not os.path.exists(meta_path):
                continue
            try:
                with open(meta_path, 'r') as f:
                    meta = json.load(f)
                names.append(meta.get('font_name', entry.name))
            except Exception:
                pass
        return names

    async def get_cached_font_names(self) -> list:
        return await asyncio.to_thread(self._get_cached_font_names_sync)

    def _clear_font_cache_sync(self, exclude_fonts: list = None) -> bool:
        """Delete cached fonts, optionally keeping some."""
        try:
            if not os.path.exists(self._font_cache_dir):
                return True
            exclude = set(exclude_fonts or [])
            if not exclude:
                shutil.rmtree(self._font_cache_dir)
                os.makedirs(self._font_cache_dir, exist_ok=True)
                self._logger.info("Font cache cleared")
            else:
                for entry in os.scandir(self._font_cache_dir):
                    if not entry.is_dir():
                        continue
                    meta_path = os.path.join(entry.path, 'meta.json')
                    font_name = entry.name
                    if os.path.exists(meta_path):
                        try:
                            with open(meta_path, 'r') as f:
                                meta = json.load(f)
                            font_name = meta.get('font_name', entry.name)
                        except Exception:
                            pass
                    if font_name not in exclude:
                        shutil.rmtree(entry.path)
                        self._logger.info(f"Removed cached font: {font_name}")
                    else:
                        self._logger.info(f"Kept cached font: {font_name}")
            return True
        except Exception as e:
            self._logger.error(f"Failed to clear font cache: {e}")
            return False

    async def clear_font_cache(self, exclude_fonts: list = None) -> bool:
        return await asyncio.to_thread(self._clear_font_cache_sync, exclude_fonts)
