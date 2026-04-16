import { useTranslation } from 'react-i18next';

import { Modal } from './ui/Modal.js';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const { t } = useTranslation();

  const features = [
    t('help.doubleClickAgent'),
    t('help.clickAgent'),
    t('help.middleDrag'),
    t('help.shiftScroll'),
    t('help.ctrlScroll'),
    t('help.clickBulletin'),
    t('help.addAgent'),
    t('help.layoutEditor'),
  ];

  const shortcuts = [
    t('help.editRotate'),
    t('help.editToggle'),
    t('help.editUndo'),
    t('help.editRedo'),
    t('help.editEsc'),
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('help.title')} className="min-w-md">
      <div className="flex gap-16 px-10 pb-8">
        {/* Features */}
        <div className="flex-1">
          <div
            className="text-accent-bright text-base mb-6"
            style={{ borderBottom: '2px solid var(--pixel-border, #44475a)', paddingBottom: 4 }}
          >
            {t('help.features')}
          </div>
          <ul className="list-none p-0 m-0">
            {features.map((item, i) => (
              <li
                key={i}
                className="text-sm text-text py-2"
                style={{ lineHeight: 1.5 }}
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
        {/* Shortcuts */}
        <div className="flex-1">
          <div
            className="text-accent-bright text-base mb-6"
            style={{ borderBottom: '2px solid var(--pixel-border, #44475a)', paddingBottom: 4 }}
          >
            {t('help.shortcuts')}
          </div>
          <ul className="list-none p-0 m-0">
            {shortcuts.map((item, i) => (
              <li
                key={i}
                className="text-sm text-text-muted py-2"
                style={{ lineHeight: 1.5, fontFamily: "'FS Pixel Sans', monospace" }}
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
