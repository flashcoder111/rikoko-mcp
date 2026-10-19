import importlib.util
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('caption_media', ROOT / 'python/media_core/cli.py')
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class CaptionStyleTest(unittest.TestCase):
    def test_bundled_fonts_support_chinese_and_real_variable_weights(self):
        for family in ('noto-sans-sc', 'noto-serif-sc'):
            light = media.font(32, {'fontFamily': family, 'fontWeight': 300})
            bold = media.font(32, {'fontFamily': family, 'fontWeight': 700})
            self.assertNotEqual(bytes(light.getmask('你好世界 Aa')), bytes(bold.getmask('你好世界 Aa')))
            self.assertNotEqual(bytes(light.getmask('你')), bytes(light.getmask('好')))
        self.assertNotEqual(bytes(media.font(32, {'fontFamily': 'noto-sans-sc'}).getmask('字幕')),
                            bytes(media.font(32, {'fontFamily': 'noto-serif-sc'}).getmask('字幕')))
        with self.assertRaises(ValueError):
            media.font(32, {'fontFamily': '../../secret'})

    def test_stroke_shadow_and_transparent_background_change_real_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            style = {'fontFamily': 'noto-sans-sc', 'fontWeight': 700, 'backgroundOpacity': 0}
            for name, effects in [('plain', {}), ('stroke', {'strokeWidth': 3, 'strokeColor': '#ff0000'}),
                                  ('shadow', {'shadowOpacity': 0.8, 'shadowColor': '#00ff00', 'shadowBlur': 6, 'shadowOffsetX': 8, 'shadowOffsetY': 5})]:
                media.overlay_text(path / f'{name}.png', 360, 640, '中文 Style', 32, '#ffffff', '#151a22', style={**style, **effects})
            with Image.open(path / 'plain.png') as plain, Image.open(path / 'stroke.png') as stroke, Image.open(path / 'shadow.png') as shadow:
                self.assertEqual(plain.getpixel((17, 540))[3], 0)
                self.assertIsNotNone(ImageChops.difference(plain, stroke).getbbox())
                self.assertIsNotNone(ImageChops.difference(plain, shadow).getbbox())
                self.assertTrue(any(r > 150 and g < 50 and a > 100 for r, g, b, a in stroke.getdata()))
                self.assertTrue(any(g > r and g > b and a > 0 for r, g, b, a in shadow.getdata()))

    def test_ffmpeg_exports_styled_scene_and_event_captions_with_plain_srt(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            composition = {'schemaVersion': 1, 'title': 'Styled captions', 'width': 360, 'height': 640, 'fps': 24, 'language': 'zh',
                'scenes': [{'id': 's', 'durationMs': 1000, 'sourceStartMs': 0, 'text': '字体测试', 'color': '#263f4d', 'fit': 'contain', 'volume': 1}],
                'events': [{'id': 'e', 'sceneId': 's', 'offsetMs': 500, 'durationMs': 300, 'kind': 'text', 'text': '描边与阴影'}],
                'captionStyle': {'fontSize': 32, 'fontFamily': 'noto-serif-sc', 'fontWeight': 700, 'color': '#ffffff', 'background': '#000000',
                    'backgroundOpacity': 0, 'strokeWidth': 2, 'strokeColor': '#111111', 'shadowOpacity': 0.7, 'shadowBlur': 4}}
            result = media.render({'composition': composition, 'assets': {}}, work)
            self.assertTrue(Path(result['output']).is_file())
            self.assertAlmostEqual(result['metadata']['durationMs'], 1000, delta=60)
            subtitles = Path(result['subtitles']).read_text()
            self.assertIn('00:00:00,000 --> 00:00:01,000\n字体测试', subtitles)
            self.assertIn('00:00:00,500 --> 00:00:00,800\n描边与阴影', subtitles)
            self.assertNotIn('font', subtitles)


if __name__ == '__main__':
    unittest.main()
