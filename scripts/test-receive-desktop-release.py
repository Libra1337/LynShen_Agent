import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).with_name('receive-desktop-release.py'))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class ReceiverTests(unittest.TestCase):
    def rejected(self, name, kind=tarfile.REGTYPE):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.linkname = '/etc/passwd'
            archive.addfile(member, io.BytesIO())
        data.seek(0)
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                receiver.receive(data, root)
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_traversal_and_absolute_paths(self):
        for name in ('../escape', '/etc/passwd', '1.2.3/../../escape', '1.2.3/a/b'):
            with self.subTest(name=name):
                self.rejected(name)

    def test_links_are_never_extracted(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
            self.rejected('1.2.3/file.exe', kind)


if __name__ == '__main__':
    unittest.main()
