"""Publish a validated distribution without restarting Monoize or its ingress."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile


def publish(source, root):
    source, root = Path(source).resolve(), Path(root).resolve()
    latest = json.loads((source / 'latest.json').read_text())
    version = latest['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid release version')
    root.mkdir(parents=True, exist_ok=True)
    with (root / '.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current_path = root / 'latest.json'
        if current_path.exists():
            current = json.loads(current_path.read_text())['version']
            if tuple(map(int, current.split('.'))) > tuple(map(int, version.split('.'))):
                raise ValueError('Refusing to publish an older release')
        staged = source / version
        destination = root / version
        if destination.exists():
            before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in destination.iterdir()}
            after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in staged.iterdir()}
            if before != after:
                raise ValueError('Published version assets are immutable')
        else:
            temporary = Path(tempfile.mkdtemp(prefix='.release-', dir=root))
            try:
                shutil.copytree(staged, temporary, dirs_exist_ok=True)
                temporary.chmod(0o755)
                for entry in temporary.iterdir():
                    entry.chmod(0o644)
                temporary.rename(destination)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
        if not (root / 'policy').exists():
            (root / 'policy').write_text('{"min_version":""}\n')
            (root / 'policy').chmod(0o644)
        for name in ('catalog.json', 'latest.json'):
            fd, filename = tempfile.mkstemp(prefix='.manifest-', dir=root)
            try:
                with os.fdopen(fd, 'wb') as output:
                    output.write((source / name).read_bytes())
                    output.flush()
                    os.fsync(output.fileno())
                os.chmod(filename, 0o644)
                os.replace(filename, root / name)
            finally:
                if os.path.exists(filename):
                    os.unlink(filename)
    print(f'Published desktop {version}')


if __name__ == '__main__':
    publish(*sys.argv[1:])
