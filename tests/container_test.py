import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'python/media_core/cli.py'


class ContainerProbeTest(unittest.TestCase):
    def test_detects_actual_container_without_trusting_the_filename(self):
        spec = importlib.util.spec_from_file_location('media_cli', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='rikoko-containers-') as directory:
            work = pathlib.Path(directory)
            for container, codec in [('mp4', 'libx264'), ('mov', 'libx264'), ('webm', 'libvpx-vp9')]:
                with self.subTest(container=container):
                    # Uploads have no trusted extension; an H.264 stream alone does not identify MP4.
                    path = work / 'upload'
                    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                                    'color=c=blue:s=144x256:r=24:d=0.2', '-threads', '1',
                                    '-c:v', codec, '-f', container, str(path)], check=True)
                    self.assertEqual(module.probe(str(path))['container'], container)


if __name__ == '__main__':
    unittest.main()
