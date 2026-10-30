import React from 'react';
import { FolderOpen, X } from 'lucide-react';

interface WatchProjectPromptProps {
  open: boolean;
  hasBridge: boolean;
  busy?: boolean;
  onChoose: () => void;
  onDismiss: () => void;
}

export const WatchProjectPrompt: React.FC<WatchProjectPromptProps> = ({
  open,
  hasBridge,
  busy = false,
  onChoose,
  onDismiss,
}) => {
  if (!open) return null;

  return (
    <div className="watch-project-backdrop" data-testid="watch-project-prompt-backdrop">
      <section
        className="watch-project-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-project-title"
        data-testid="watch-project-prompt"
      >
        <button
          type="button"
          className="watch-project-close"
          onClick={onDismiss}
          aria-label="Dismiss project folder prompt"
        >
          <X size={15} />
        </button>
        <div className="watch-project-icon" aria-hidden="true">
          <FolderOpen size={20} />
        </div>
        <h2 id="watch-project-title">
          Give us the project folder to spectate and we can keep this even more up to date
        </h2>
        <p>
          FaultMesh can watch future saved changes while this recorded session remains unchanged.
        </p>
        {hasBridge ? (
          <button
            type="button"
            className="watch-project-primary"
            onClick={onChoose}
            disabled={busy}
            data-testid="watch-project-choose"
          >
            <FolderOpen size={15} />
            {busy ? 'Opening folder picker…' : 'Choose project folder'}
          </button>
        ) : (
          <div className="watch-project-unavailable" data-testid="watch-project-no-bridge">
            Desktop app required to watch local projects
          </div>
        )}
        <button type="button" className="watch-project-later" onClick={onDismiss}>
          Not now
        </button>
      </section>
    </div>
  );
};
