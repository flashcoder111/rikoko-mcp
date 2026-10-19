import array
import importlib.util
import math
import pathlib
import subprocess
import tempfile
import unittest
import wave

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'python/media_core/cli.py'


class SoundMixTest(unittest.TestCase):
    def test_sound_is_timed_and_mixed_with_native_audio_and_music(self):
        spec = importlib.util.spec_from_file_location('sound_media_cli', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='rikoko-sound-mix-') as directory:
            work = pathlib.Path(directory)
            source = work / 'source.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=144x256:r=24:d=2',
                            '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2',
                            '-c:v', 'libx264', '-c:a', 'aac', '-shortest', str(source)], check=True)
            effect = work / 'effect.wav'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', str(effect)], check=True)
            composition = {'schemaVersion': 1, 'title': 'Sound mix', 'width': 144, 'height': 256, 'fps': 24, 'language': 'en',
                           'scenes': [{'id': 'a', 'durationMs': 2000, 'sourceStartMs': 0, 'assetId': 'source', 'text': '', 'color': '#173b42', 'volume': 1, 'fit': 'contain'}],
                           'events': [{'id': 'sfx', 'sceneId': 'a', 'kind': 'sound', 'assetId': 'effect', 'offsetMs': 500, 'durationMs': 1000, 'gain': 1, 'text': ''}],
                           'audio': {'toneHz': 440, 'gain': .5},
                           'captionStyle': {'fontSize': 12, 'color': '#ffffff', 'background': '#151a22'}}
            result = module.render({'composition': composition, 'assets': {'source': str(source), 'effect': str(effect)}}, work)
            samples = array.array('h', subprocess.run(['ffmpeg', '-v', 'error', '-i', result['output'], '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], capture_output=True, check=True).stdout)
            self.assertGreaterEqual(len(samples), 90000, result['metadata'])
            def amplitude(frequency, start, end):
                values = samples[round(start * 48000):round(end * 48000)]
                real = sum(x * math.cos(2 * math.pi * frequency * i / 48000) for i, x in enumerate(values))
                imaginary = sum(x * math.sin(2 * math.pi * frequency * i / 48000) for i, x in enumerate(values))
                return math.hypot(real, imaginary) / len(values)
            for start, end in ((.15, .35), (.7, .9), (1.7, 1.9)):
                self.assertGreater(amplitude(220, start, end), 500)
                self.assertGreater(amplitude(440, start, end), 200)
            self.assertGreater(amplitude(880, .7, .9), 500)
            self.assertLess(amplitude(880, .15, .35), 50)
            self.assertLess(amplitude(880, 1.7, 1.9), 50)
            self.assertEqual(pathlib.Path(result['subtitles']).read_text(), '')


if __name__ == '__main__':
    unittest.main()
