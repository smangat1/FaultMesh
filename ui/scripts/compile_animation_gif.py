import os
from PIL import Image

SCREENSHOTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../docs/screenshots'))
OUTPUT_GIF_PATH = os.path.join(SCREENSHOTS_DIR, 'agent_investigation_demo.gif')

PHASE_FILES = [
    '08_agent_phase0_diagnosing_1440x920.png',
    '08_agent_phase1_tracing_1440x920.png',
    '08_agent_phase2_inspecting_1440x920.png',
    '08_agent_phase3_patching_1440x920.png',
    '08_agent_phase4_verifying_1440x920.png',
    '08_agent_phase5_resolved_1440x920.png',
]

DURATIONS_MS = [
    2400, # Phase 0: Diagnosing
    2500, # Phase 1: Tracing
    3200, # Phase 2: Inspecting
    3400, # Phase 3: Patching
    2800, # Phase 4: Verifying
    4000, # Phase 5: Resolved
]

def main():
    images = []
    for filename in PHASE_FILES:
        filepath = os.path.join(SCREENSHOTS_DIR, filename)
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}")
            return
        img = Image.open(filepath).convert('RGB')
        # Scale to crisp 1200x766 for efficient gif file size
        img = img.resize((1200, 766), Image.Resampling.LANCZOS)
        # Convert to adaptive palette for crisp obsidian colors
        img = img.convert('P', palette=Image.Palette.ADAPTIVE, colors=256)
        images.append(img)

    if images:
        images[0].save(
            OUTPUT_GIF_PATH,
            save_all=True,
            append_images=images[1:],
            duration=DURATIONS_MS,
            loop=0,
            optimize=True,
        )
        print(f"Successfully compiled animated demo: {OUTPUT_GIF_PATH} ({os.path.getsize(OUTPUT_GIF_PATH)} bytes)")

if __name__ == '__main__':
    main()
