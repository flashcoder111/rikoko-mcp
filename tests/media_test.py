import importlib.util
import pathlib
import unittest
import array
import math
import struct
import subprocess
import tempfile
import wave

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'python/media_core/cli.py'

class MediaContractTest(unittest.TestCase):
    def test_timed_speech_captions_export_srt_in_source_order(self):
        spec = importlib.util.spec_from_file_location('media_cli', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='speech-captions-') as directory:
            work = pathlib.Path(directory)
            composition = {'schemaVersion': 1, 'title': 'Speech captions', 'width': 144, 'height': 256,
                'fps': 24, 'language': 'zh',
                'scenes': [{'id': 'a', 'durationMs': 2000, 'sourceStartMs': 0, 'text': '', 'color': '#173b42', 'fit': 'contain', 'volume': 1,
                    'words': [{'id': 'w0', 'text': '你好', 'startMs': 200, 'endMs': 700}]}],
                'events': [{'id': 'late', 'sceneId': 'a', 'offsetMs': 1000, 'durationMs': 500, 'kind': 'text', 'text': '世界'},
                           {'id': 'early', 'sceneId': 'a', 'wordId': 'w0', 'offsetMs': 0, 'durationMs': 500, 'kind': 'text', 'text': '你好'}],
                'captionStyle': {'fontSize': 12, 'color': '#ffffff', 'background': '#151a22'}}
            result = module.render({'composition': composition, 'assets': {}}, work)
            self.assertEqual(pathlib.Path(result['subtitles']).read_text(), '1\n00:00:00,200 --> 00:00:00,700\n你好\n\n2\n00:00:01,000 --> 00:00:01,500\n世界\n')

    def test_speed_preserves_pitch_late_source_and_volume_curve(self):
        spec = importlib.util.spec_from_file_location('media_cli', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='audio-speed-') as directory:
            work = pathlib.Path(directory)
            source = work / 'source.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=144x256:r=24:d=2',
                '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
                '-c:v', 'libx264', '-c:a', 'aac', '-shortest', str(source)], check=True)
            for speed in (2, .5):
                target = work / str(speed)
                target.mkdir()
                duration = 2000 / speed
                scene = {'id': 'a', 'durationMs': int(duration), 'assetId': 'source', 'speed': speed,
                    'sourceStartMs': 0, 'text': 'Speed', 'color': '#173b42', 'fit': 'contain', 'volume': 1,
                    'volumeEnvelope': [{'timeMs': 0, 'gain': 0}, {'timeMs': int(duration), 'gain': 1}]}
                composition = {'schemaVersion': 1, 'title': 'Speed test', 'width': 144, 'height': 256,
                    'fps': 24, 'language': 'en', 'scenes': [scene], 'events': [],
                    'captionStyle': {'fontSize': 12, 'color': '#ffffff', 'background': '#151a22'}}
                result = module.render({'composition': composition, 'assets': {'source': str(source)}}, target)
                samples = array.array('h', subprocess.run(['ffmpeg', '-v', 'error', '-i', result['output'],
                    '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], capture_output=True, check=True).stdout)
                def window(a, b):
                    return samples[round(48 * duration * a):round(48 * duration * b)]
                early, late = window(.15, .3), window(.65, .8)
                rms = lambda values: math.sqrt(sum(x*x for x in values) / len(values))
                self.assertGreater(rms(late), rms(early) * 2)
                crossings = sum(a < 0 <= b for a, b in zip(late, late[1:]))
                self.assertAlmostEqual(crossings / (len(late) / 48000), 440, delta=15)
                self.assertAlmostEqual(result['metadata']['durationMs'], duration, delta=50)
            waveform = module.waveform({'path': str(source), 'startMs': 0, 'durationMs': 2000, 'bins': 32})
            self.assertEqual(len(waveform['peaks']), 32)
            self.assertGreater(min(waveform['peaks']), .05)
            self.assertLessEqual(max(waveform['peaks']), 1)
            scene['speed'] = 4
            scene['durationMs'] = 250
            scene['volumeEnvelope'] = []
            short = work / 'short'
            short.mkdir()
            result = module.render({'composition': composition, 'assets': {'source': str(source)}}, short)
            self.assertTrue(pathlib.Path(result['preview']).is_file())

    def test_trimmed_narration_uses_source_offset_in_real_render(self):
        spec = importlib.util.spec_from_file_location('media_cli', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='narration-trim-') as directory:
            work = pathlib.Path(directory)
            voice = work / 'two-tones.wav'
            rate = 48000
            # Distinct first/second seconds make a wrong seek audible and measurable.
            with wave.open(str(voice), 'wb') as output:
                output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
                output.writeframes(b''.join(struct.pack('<h', round(12000 * math.sin(2 * math.pi * (440 if i < rate else 880) * i / rate))) for i in range(rate * 2)))
            composition = {
                'schemaVersion': 1, 'title': 'Trim sync regression',
                'width': 144, 'height': 256, 'fps': 24, 'language': 'en',
                'scenes': [{'id': 'trimmed', 'durationMs': 1000, 'sourceStartMs': 0,
                            'audioAssetId': 'voice', 'audioSourceStartMs': 1000,
                            'text': '', 'color': '#173b42', 'fit': 'contain', 'volume': 1}],
                'events': [], 'captionStyle': {'fontSize': 12, 'color': '#ffffff', 'background': '#151a22'},
            }
            result = module.render({'composition': composition, 'assets': {'voice': str(voice)}}, work)
            decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', result['output'], '-vn', '-ac', '1', '-ar', str(rate), '-f', 's16le', '-'], capture_output=True, check=True).stdout
            samples = array.array('h', decoded)[int(rate * .2):int(rate * .8)]
            crossings = sum(a < 0 <= b for a, b in zip(samples, samples[1:]))
            frequency = crossings / .6
            self.assertAlmostEqual(frequency, 880, delta=15)
            self.assertAlmostEqual(result['metadata']['durationMs'], 1000, delta=100)

    def test_render_rejects_invalid_scene_timing(self):
        spec = importlib.util.spec_from_file_location('media_cli', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaises(ValueError):
            module.validate_timeline({'scenes': [{'id': 'a', 'durationMs': 0}], 'events': []})

    def test_render_rejects_missing_word_anchor(self):
        spec = importlib.util.spec_from_file_location('media_cli', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaises(ValueError):
            module.validate_timeline({'scenes': [{'id':'a','durationMs':1000}], 'events':[{'sceneId':'a','wordId':'missing','offsetMs':0,'durationMs':100}]})

if __name__ == '__main__':
    unittest.main()
