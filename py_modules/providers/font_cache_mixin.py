import os

import decky_plugin

from providers.font_cache_service import FontCacheService


class FontCacheMixin:
    # Declared here to make the implicit contract explicit and prevent
    # AttributeError if _init_font_cache is called before the host class
    # sets the attribute (e.g. wrong MRO or missing class-level declaration).
    _font_cache_service: "FontCacheService | None" = None

    def _init_font_cache(self):
        """Initialise the on-disk font cache service."""
        if self._font_cache_service is None:
            settings_dir = os.environ.get("DECKY_PLUGIN_SETTINGS_DIR", "/home/deck/homebrew/settings")
            self._font_cache_service = FontCacheService(decky_plugin.logger, settings_dir)
        self._font_cache_service.initialize()

    async def cache_font(self, font_name: str, css_urls: list) -> dict:
        if self._font_cache_service is None:
            return {"success": False, "error": "Font cache not initialised"}
        return await self._font_cache_service.cache_font(font_name, css_urls)

    async def get_cached_font_css(self, font_name: str) -> str:
        if self._font_cache_service is None:
            return ""
        return await self._font_cache_service.get_cached_font_css(font_name)

    async def is_font_cached(self, font_name: str) -> bool:
        if self._font_cache_service is None:
            return False
        return await self._font_cache_service.is_font_cached(font_name)

    async def get_font_cache_info(self) -> dict:
        if self._font_cache_service is None:
            return {'totalFonts': 0, 'totalSizeBytes': 0, 'fonts': []}
        return await self._font_cache_service.get_font_cache_info()

    async def get_cached_font_names(self) -> list:
        if self._font_cache_service is None:
            return []
        return await self._font_cache_service.get_cached_font_names()

    async def clear_font_cache(self, exclude_fonts: list = None) -> bool:
        if self._font_cache_service is None:
            return True
        return await self._font_cache_service.clear_font_cache(exclude_fonts)
