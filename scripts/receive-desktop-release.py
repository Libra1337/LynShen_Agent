"""Restricted SSH receiver. Install beside the publisher as root-owned files."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import tempfile
from urllib.parse import unquote, urlsplit


def receive(stream, root):
    root = Path(root).resolve()
    with tempfile.TemporaryDirectory(prefix='.incoming-', dir=root) as temporary:
        stage = Path(temporary)
        total = 0
        names = set()
        with tarfile.open(fileobj=stream, mode='r|gz') as archive:
            for member in archive:
                name = member.name.removeprefix('./')
                if member.isdir() and name in ('', '.'):
                    continue
                parts = PurePosixPath(name).parts
                if (not parts or len(parts) > 2 or PurePosixPath(name).is_absolute()
                        or any(not re.fullmatch(r'[A-Za-z0-9_+.-]+', part)
                               or part in ('.', '..') for part in parts)
                        or name in names or len(names) >= 64):
                    raise ValueError('Invalid archive path or entry count')
                names.add(name)
                if member.isdir():
                    if len(parts) != 1 or not re.fullmatch(r'\d+\.\d+\.\d+', name):
                        raise ValueError('Invalid release directory')
                    (stage / name).mkdir(exist_ok=True)
                    continue
                total += member.size
                if not member.isfile() or member.size < 0 or total > 2 * 1024**3:
                    raise ValueError('Invalid release entry or size')
                target = stage / name
                target.parent.mkdir(exist_ok=True)
                source = archive.extractfile(member)
                with target.open('xb') as output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
        latest = json.loads((stage / 'latest.json').read_text())
        catalog = json.loads((stage / 'catalog.json').read_text())
        version = latest['version']
        if not re.fullmatch(r'\d+\.\d+\.\d+', version) or catalog['version'] != version:
            raise ValueError('Invalid manifest version')
        expected = {'latest.json', 'catalog.json', version}

        def artifact(url, absolute):
            parsed = urlsplit(url)
            if (parsed.query or parsed.fragment or parsed.username or parsed.password
                    or (absolute and (parsed.scheme != 'https' or parsed.netloc not in
                                      ('www.lynshen.org', 'api.lynshen.org')))
                    or (not absolute and (parsed.scheme or parsed.netloc))):
                raise ValueError('Invalid artifact origin')
            prefix = f'/v1/public/releases/desktop/{version}/'
            if not parsed.path.startswith(prefix):
                raise ValueError('Invalid artifact URL')
            filename = unquote(parsed.path[len(prefix):])
            if not re.fullmatch(r'[A-Za-z0-9_+.-]+', filename) or filename in ('.', '..'):
                raise ValueError('Invalid artifact filename')
            relative = version + '/' + filename
            expected.add(relative)
            return stage / relative

        if not latest.get('platforms') or not catalog.get('platforms'):
            raise ValueError('Empty release')
        for entry in latest['platforms'].values():
            path = artifact(entry['url'], True)
            signature = path.with_name(path.name + '.sig')
            expected.add(signature.relative_to(stage).as_posix())
            if not path.is_file() or not entry['signature'].strip() or signature.read_text().strip() != entry['signature'].strip():
                raise ValueError('Missing or mismatched signed artifact')
        for platform, entry in catalog['platforms'].items():
            if platform not in latest['platforms']:
                raise ValueError('Installer has no updater platform')
            path = artifact(entry['url'], False)
            with path.open('rb') as source:
                digest = hashlib.file_digest(source, 'sha256').hexdigest()
            if digest != entry['sha256']:
                raise ValueError('Installer checksum mismatch')
        if names - expected:
            raise ValueError('Unexpected release files')
        spec = importlib.util.spec_from_file_location('desktop_publisher', Path(__file__).with_name('publish-desktop-release.py'))
        publisher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(publisher)
        publisher.publish(stage, root)


if __name__ == '__main__':
    if os.environ.get('SSH_ORIGINAL_COMMAND') != 'publish-desktop-release':
        raise SystemExit('Only desktop publication is allowed')
    receive(sys.stdin.buffer, sys.argv[1])
