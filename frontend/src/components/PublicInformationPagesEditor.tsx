import { useEffect, useState, type FormEvent } from 'react';

import {
  getManagedPublicInformationPages,
  updateManagedPublicInformationPage,
  type PublicInformationPage,
  type PublicInformationPageContent,
} from '../api/publicInformation';
import { getErrorMessage } from '../api/client';
import type { MessageKey } from '../i18n';

interface PublicInformationPagesEditorProps {
  text: (key: MessageKey) => string;
}

const pageTitleKeys: Record<PublicInformationPage['page'], MessageKey> = {
  about: 'about',
  contact: 'contact',
  'property-management': 'propertyManagement',
};

const fields: {
  key: keyof PublicInformationPageContent;
  label: MessageKey;
  multiline?: boolean;
  rows?: number;
  maxLength: number;
}[] = [
  { key: 'title_en', label: 'publicPageTitleEnglish', maxLength: 160 },
  { key: 'title_am', label: 'publicPageTitleAmharic', maxLength: 160 },
  { key: 'introduction_en', label: 'publicPageIntroEnglish', multiline: true, rows: 2, maxLength: 500 },
  { key: 'introduction_am', label: 'publicPageIntroAmharic', multiline: true, rows: 2, maxLength: 500 },
  { key: 'body_en', label: 'publicPageBodyEnglish', multiline: true, rows: 5, maxLength: 5000 },
  { key: 'body_am', label: 'publicPageBodyAmharic', multiline: true, rows: 5, maxLength: 5000 },
];

export function PublicInformationPagesEditor({ text }: PublicInformationPagesEditorProps) {
  const [pages, setPages] = useState<PublicInformationPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingPage, setSavingPage] = useState<PublicInformationPage['page'] | null>(null);
  const [saveError, setSaveError] = useState('');
  const [savedPage, setSavedPage] = useState<PublicInformationPage['page'] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getManagedPublicInformationPages(controller.signal)
      .then((managedPages) => {
        if (!controller.signal.aborted) setPages(managedPages);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const updateField = (
    pageSlug: PublicInformationPage['page'],
    field: keyof PublicInformationPageContent,
    value: string,
  ) => {
    setPages((current) => current.map((page) => (
      page.page === pageSlug ? { ...page, [field]: value } : page
    )));
    setSaveError('');
    setSavedPage(null);
  };

  const savePage = async (
    event: FormEvent<HTMLFormElement>,
    page: PublicInformationPage,
  ) => {
    event.preventDefault();
    setSavingPage(page.page);
    setSaveError('');
    setSavedPage(null);
    try {
      const updated = await updateManagedPublicInformationPage(page.page, {
        title_en: page.title_en,
        title_am: page.title_am,
        introduction_en: page.introduction_en,
        introduction_am: page.introduction_am,
        body_en: page.body_en,
        body_am: page.body_am,
      });
      setPages((current) => current.map((item) => item.page === updated.page ? updated : item));
      setSavedPage(page.page);
    } catch (error: unknown) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSavingPage(null);
    }
  };

  return (
    <section className="manager-form manager-form-section public-page-editor" aria-labelledby="public-pages-editor-title">
      <div>
        <h2 id="public-pages-editor-title">{text('publicPagesManagementTitle')}</h2>
        <p className="manager-hint">{text('publicPagesManagementIntro')}</p>
      </div>
      {loading ? (
        <div className="listing-state" role="status">{text('publicPagesLoading')}</div>
      ) : loadError ? (
        <p className="manager-inline-error" role="alert">{text('publicPagesLoadError')} {loadError}</p>
      ) : (
        <div className="public-page-editor-list">
          {pages.map((page) => (
            <form
              className="public-page-editor-card"
              key={page.page}
              onSubmit={(event) => void savePage(event, page)}
            >
              <h3>{text(pageTitleKeys[page.page])}</h3>
              <div className="public-page-editor-fields">
                {fields.map(({ key, label, multiline, rows, maxLength }) => (
                  <label className="manager-field" key={key}>
                    <span>{text(label)}</span>
                    {multiline ? (
                      <textarea
                        required={key.startsWith('introduction_')}
                        maxLength={maxLength}
                        rows={rows}
                        value={page[key]}
                        onChange={(event) => updateField(page.page, key, event.target.value)}
                      />
                    ) : (
                      <input
                        required
                        maxLength={maxLength}
                        value={page[key]}
                        onChange={(event) => updateField(page.page, key, event.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>
              {savedPage === page.page && (
                <p className="manager-inline-success" role="status">{text('publicPageSaved')}</p>
              )}
              {saveError && savingPage === null && savedPage === null && (
                <p className="manager-inline-error" role="alert">{text('publicPageSaveError')} {saveError}</p>
              )}
              <div className="manager-form-actions">
                <button className="button button-primary" type="submit" disabled={savingPage !== null}>
                  {savingPage === page.page ? text('publicPageSaving') : text('publicPageSave')}
                </button>
              </div>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
