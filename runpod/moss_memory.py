"""Sample driver-visible VRAM via nvidia-smi (NVML); never claim allocator peaks."""
import subprocess
import threading


class MemorySampler:
    def __init__(self, interval_s=0.5):
        self.interval_s = interval_s
        self.peaks = {}
        self.samples = 0
        self.error = None
        self.stop = threading.Event()

    def sample(self):
        try:
            output = subprocess.check_output(
                ['nvidia-smi', '--query-gpu=uuid,memory.used', '--format=csv,noheader,nounits'],
                text=True, stderr=subprocess.DEVNULL, timeout=2)
            for line in output.splitlines():
                device, used = line.rsplit(',', 1)
                self.peaks[device.strip()] = max(self.peaks.get(device.strip(), 0), float(used))
            self.samples += 1
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            self.error = str(error)

    def _loop(self):
        while not self.stop.wait(self.interval_s):
            self.sample()

    def __enter__(self):
        self.sample()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop.set()
        self.thread.join(timeout=3)
        self.sample()

    def result(self):
        return {'source': 'nvidia-smi/NVML', 'sample_interval_s': self.interval_s,
                'sample_count': self.samples, 'sampled_device_peak_mib': dict(self.peaks),
                'note': 'Sampled device-wide use; includes other allocations and may miss short peaks.',
                'error': self.error}
