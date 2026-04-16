import { useTranslation } from 'react-i18next';

import { Button } from './ui/Button.js';

interface MigrationNoticeProps {
  onDismiss: () => void;
}

export function MigrationNotice({ onDismiss }: MigrationNoticeProps) {
  const { t } = useTranslation();

  return (
    <div
      className="absolute inset-0 bg-black/70 flex items-center justify-center z-100"
      onClick={onDismiss}
    >
      <div
        className="pixel-panel py-24 px-32 max-w-xl text-center leading-[1.3]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-5xl mb-12 text-accent">{t('migration.title')}</div>
        <p className="text-xl m-0 mb-12">
          {t('migration.message')}
        </p>
        <p className="text-xl m-0 mb-12">
          {t('migration.resetNotice')}
        </p>
        <p className="text-xl m-0 mb-20">{t('migration.stayTuned')}</p>
        <Button variant="accent" size="xl" onClick={onDismiss}>
          {t('migration.gotIt')}
        </Button>
      </div>
    </div>
  );
}
