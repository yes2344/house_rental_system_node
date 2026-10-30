import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../AuthContext';
import { getErrorMessage } from '../api/client';
import type { BrokerageContact, BrokerageSocialLink, SocialPlatform } from '../api/brokerage';
import {
  createHomepageNote,
  deleteHomepageNote,
  getManagedHomepageNotes,
  updateHomepageNote,
  type HomepageNote,
  type HomepageNotePayload,
} from '../api/homepageContent';
import { useHomepageContent } from '../HomepageContentContext';
import { PublicInformationPagesEditor } from '../components/PublicInformationPagesEditor';
import { SocialMark } from '../components/SocialMark';
import { useBrokerageContact } from '../BrokerageContactContext';
import type { MessageKey } from '../i18n';

interface BrokerageSettingsPageProps {
  text: (key: MessageKey) => string;
}

const fields: { name: 'business_name' | 'phone' | 'email'; label: MessageKey; type: string }[] = [
  { name: 'business_name', label: 'brokerageBusinessName', type: 'text' },
  { name: 'phone', label: 'brokeragePhone', type: 'tel' },
  { name: 'email', label: 'brokerageEmail', type: 'email' },
];

const socialPlatforms: SocialPlatform[] = [
  'facebook',
  'whatsapp',
  'telegram',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'x',
];

const socialLabelKey: Record<SocialPlatform, MessageKey> = {
  facebook: 'brokerageFacebook',
  whatsapp: 'brokerageWhatsApp',
  telegram: 'brokerageTelegram',
  instagram: 'brokerageInstagram',
  tiktok: 'brokerageTikTok',
  youtube: 'brokerageYouTube',
  linkedin: 'brokerageLinkedIn',
  x: 'brokerageX',
};

const blankNote: HomepageNotePayload = {
  title: '',
  text: '',
  is_published: false,
  display_order: 0,
};

export function BrokerageSettingsPage({ text }: BrokerageSettingsPageProps) {
  const { account } = useAuth();
  const { contact, loading, error, save } = useBrokerageContact();
  const { refresh: refreshHomepageContent } = useHomepageContent();
  const [values, setValues] = useState<BrokerageContact>(contact);
  const [socialLinks, setSocialLinks] = useState<BrokerageSocialLink[]>(contact.social_links);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [notes, setNotes] = useState<HomepageNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState('');
  const [noteForm, setNoteForm] = useState<HomepageNotePayload>(blankNote);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteImage, setEditingNoteImage] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaveError, setNoteSaveError] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const canEdit = Boolean(
    account?.is_platform_owner
    || (account?.role === 'agent' && account.management_permissions.includes('settings.manage')),
  );

  useEffect(() => {
    setValues(contact);
    setSocialLinks(contact.social_links);
  }, [contact]);

  const loadNotes = async (signal?: AbortSignal) => {
    setNotesLoading(true);
    setNotesError('');
    try {
      setNotes(await getManagedHomepageNotes(signal));
    } catch (requestError: unknown) {
      if (!signal?.aborted) setNotesError(getErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setNotesLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void loadNotes(controller.signal);
    return () => controller.abort();
  }, []);

  const update = (name: keyof BrokerageContact, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setSaveError('');
    setSaved(false);
  };

  const updateSocial = (
    platform: SocialPlatform,
    updates: Partial<BrokerageSocialLink>,
  ) => {
    setSocialLinks((current) => {
      const existing = current.find((link) => link.platform === platform);
      if (existing) {
        return current.map((link) => link.platform === platform ? { ...link, ...updates } : link);
      }
      return [...current, {
        platform,
        url: '',
        is_enabled: true,
        display_order: current.length,
        ...updates,
      }];
    });
    setSaveError('');
    setSaved(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      await save({
        business_name: values.business_name,
        phone: values.phone,
        email: values.email,
        footer_copyright: values.footer_copyright,
        social_links: socialLinks
          .filter((link) => link.url.trim())
          .map((link) => ({ ...link, url: link.url.trim() })),
      });
      setSaved(true);
    } catch (requestError: unknown) {
      setSaveError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const submitNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNoteSaving(true);
    setNoteSaveError('');
    setNoteSaved(false);
    try {
      if (editingNoteId === null) await createHomepageNote(noteForm);
      else await updateHomepageNote(editingNoteId, noteForm);
      setNoteForm(blankNote);
      setEditingNoteId(null);
      setEditingNoteImage('');
      setNoteSaved(true);
      await Promise.all([loadNotes(), refreshHomepageContent()]);
    } catch (requestError: unknown) {
      setNoteSaveError(getErrorMessage(requestError));
    } finally {
      setNoteSaving(false);
    }
  };

  const editNote = (note: HomepageNote) => {
    setEditingNoteId(note.id);
    setNoteForm({
      title: note.title,
      text: note.text,
      is_published: note.is_published,
      display_order: note.display_order,
    });
    setEditingNoteImage(note.image ?? '');
    setNoteSaveError('');
    setNoteSaved(false);
  };

  const toggleNotePublication = async (note: HomepageNote) => {
    setNotesError('');
    try {
      await updateHomepageNote(note.id, { is_published: !note.is_published });
      await Promise.all([loadNotes(), refreshHomepageContent()]);
    } catch (requestError: unknown) {
      setNotesError(getErrorMessage(requestError));
    }
  };

  const removeNote = async (note: HomepageNote) => {
    if (!window.confirm(text('confirmDeleteNote'))) return;
    setNotesError('');
    try {
      await deleteHomepageNote(note.id);
      if (editingNoteId === note.id) {
        setEditingNoteId(null);
        setNoteForm(blankNote);
        setEditingNoteImage('');
      }
      await Promise.all([loadNotes(), refreshHomepageContent()]);
    } catch (requestError: unknown) {
      setNotesError(getErrorMessage(requestError));
    }
  };

  if (!canEdit) {
    return (
      <main className="manager-page" id="main-content">
        <div className="manager-state manager-error" role="alert">
          <h1>{text('brokerageSettingsTitle')}</h1>
          <p>{text('brokerageSettingsPermission')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="manager-page" id="main-content">
      <section className="manager-heading">
        <div>
          <p className="eyebrow eyebrow-muted"><span className="eyebrow-dot" />{text('managerEyebrow')}</p>
          <h1>{text('brokerageSettingsTitle')}</h1>
          <p>{text('brokerageSettingsIntro')}</p>
        </div>
      </section>
      {loading ? (
        <div className="listing-state" role="status">{text('settingsLoading')}</div>
      ) : (
        <>
        <form className="manager-form" onSubmit={submit}>
          <section className="manager-form-section">
            <h2>{text('brokerageInformationHeading')}</h2>
            <div className="brokerage-contact-fields">
              {fields.map(({ name, label, type }) => (
                <label className="manager-field" key={name}>
                  <span>{text(label)}</span>
                  <input
                    type={type}
                    maxLength={name === 'business_name' ? 160 : 300}
                    value={values[name]}
                    onChange={(event) => update(name, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>
          <section className="manager-form-section">
            <h2>{text('footerCopyrightHeading')}</h2>
            <p className="manager-hint">{text('footerCopyrightHint')}</p>
            <label className="manager-field">
              <span>{text('footerCopyrightLabel')}</span>
              <input
                maxLength={200}
                value={values.footer_copyright}
                placeholder={text('footerCopyrightPlaceholder')}
                onChange={(event) => update('footer_copyright', event.target.value)}
              />
            </label>
          </section>
          <section className="manager-form-section">
            <h2>{text('socialLinksHeading')}</h2>
            <p className="manager-hint">{text('socialLinksHint')}</p>
            <div className="social-link-editor-list">
              {socialPlatforms.map((platform, index) => {
                const link = socialLinks.find((item) => item.platform === platform);
                const url = link?.url ?? '';
                const enabled = link?.is_enabled ?? true;
                const order = link?.display_order ?? index;
                return (
                  <div className="social-link-editor" key={platform}>
                    <span className="social-link-preview" aria-hidden="true"><SocialMark platform={platform} /></span>
                    <label className="manager-field social-link-url">
                      <span>{text(socialLabelKey[platform])}</span>
                      <input
                        type="url"
                        maxLength={300}
                        value={url}
                        placeholder="https://"
                        onChange={(event) => updateSocial(platform, { url: event.target.value })}
                      />
                    </label>
                    <label className="manager-field social-link-order">
                      <span>{text('socialLinkOrder')}</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={order}
                        onChange={(event) => updateSocial(platform, { display_order: Number(event.target.value) })}
                      />
                    </label>
                    <label className="amenity-choice social-link-enabled">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => updateSocial(platform, { is_enabled: event.target.checked })}
                      />
                      <span>{text('socialLinkEnabled')}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="manager-form-section">
            {error && <p className="manager-inline-error" role="status">{error}</p>}
            {saveError && <p className="manager-inline-error" role="alert">{text('brokerageSettingsError')} {saveError}</p>}
            {saved && <p className="manager-inline-success" role="status">{text('brokerageSettingsSaved')}</p>}
            <div className="manager-form-actions">
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? text('savingBrokerageSettings') : text('saveBrokerageSettings')}
              </button>
            </div>
          </section>
        </form>

        <PublicInformationPagesEditor text={text} />

        <section className="manager-form manager-form-section homepage-note-manager" aria-labelledby="homepage-note-heading">
          <div>
            <h2 id="homepage-note-heading">{text('homepageNotesTitle')}</h2>
            <p className="manager-hint">{text('homepageNotesIntro')}</p>
          </div>
          <form className="homepage-note-form" onSubmit={(event) => void submitNote(event)}>
            <label className="manager-field">
              <span>{text('homepageNoteTitle')}</span>
              <input
                maxLength={160}
                value={noteForm.title}
                onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            <label className="manager-field">
              <span>{text('homepageNoteText')}</span>
              <textarea
                required
                maxLength={2000}
                rows={4}
                value={noteForm.text}
                onChange={(event) => setNoteForm((current) => ({ ...current, text: event.target.value }))}
              />
            </label>
            <label className="manager-field homepage-note-image-field">
              <span>{text('homepageNoteImage')}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const image = event.target.files?.[0];
                  if (image) {
                    setEditingNoteImage('');
                    setNoteForm((current) => ({ ...current, image }));
                  }
                }}
              />
              <small>{text('homepageNoteImageHint')}</small>
              {editingNoteImage && (
                <img className="homepage-note-manager-image" src={editingNoteImage} alt="" />
              )}
              {noteForm.image && <small>{noteForm.image.name}</small>}
            </label>
            <div className="homepage-note-controls">
              <label className="manager-field">
                <span>{text('socialLinkOrder')}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={noteForm.display_order}
                  onChange={(event) => setNoteForm((current) => ({ ...current, display_order: Number(event.target.value) }))}
                />
              </label>
              <label className="amenity-choice">
                <input
                  type="checkbox"
                  checked={noteForm.is_published}
                  onChange={(event) => setNoteForm((current) => ({ ...current, is_published: event.target.checked }))}
                />
                <span>{text('publishHomepageNote')}</span>
              </label>
            </div>
            {noteSaveError && <p className="manager-inline-error" role="alert">{noteSaveError}</p>}
            {noteSaved && <p className="manager-inline-success" role="status">{text('homepageNoteSaved')}</p>}
            <div className="manager-form-actions">
              <button className="button button-primary" type="submit" disabled={noteSaving}>
                {noteSaving ? text('savingHomepageNote') : text(editingNoteId === null ? 'addHomepageNote' : 'saveHomepageNote')}
              </button>
              {editingNoteId !== null && (
                <button className="button button-outline" type="button" onClick={() => {
                  setEditingNoteId(null);
                  setNoteForm(blankNote);
                  setEditingNoteImage('');
                }}>
                  {text('cancel')}
                </button>
              )}
            </div>
          </form>
          {notesLoading ? (
            <div className="listing-state" role="status">{text('loadingHomepageNotes')}</div>
          ) : notesError ? (
            <p className="manager-inline-error" role="alert">{text('homepageNotesError')} {notesError}</p>
          ) : notes.length === 0 ? (
            <p className="manager-hint">{text('noHomepageNotes')}</p>
          ) : (
            <div className="homepage-note-list">
              {notes.map((note) => (
                <article className="homepage-note-row" key={note.id}>
                  <div>
                    <strong>{note.title || text('homepageNoteUntitled')}</strong>
                    <p>{note.text}</p>
                    <span className={`manager-badge ${note.is_published ? 'publication-published' : 'publication-draft'}`}>
                      {text(note.is_published ? 'publicationPublished' : 'publicationDraft')}
                    </span>
                  </div>
                  <div className="manager-row-actions">
                    <button className="manager-row-action" type="button" onClick={() => editNote(note)}>{text('editNote')}</button>
                    <button className="manager-row-action" type="button" onClick={() => void toggleNotePublication(note)}>
                      {text(note.is_published ? 'unpublishNote' : 'publishHomepageNote')}
                    </button>
                    <button className="manager-row-action" type="button" onClick={() => void removeNote(note)}>{text('deleteNote')}</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        </>
      )}
    </main>
  );
}
