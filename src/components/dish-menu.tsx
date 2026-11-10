import Image from 'next/image';
import { formatBDT, type Locale } from '@/lib/i18n/format';
import { dishPhotoUrl, type MenuDish } from '@/modules/customers/member-card-view';

/**
 * The customer's menu with dish photos, by category (member card page and table page). Server only:
 * photo links come from the public menu-photos bucket.
 */
export function DishMenu({
  dishes,
  locale,
  otherLabel,
}: {
  dishes: MenuDish[];
  locale: Locale;
  /** The heading for dishes with no category. */
  otherLabel: string;
}) {
  const categories = [...new Set(dishes.map((m) => m.cat))];
  return (
    <>
      {categories.map((cat) => {
        const items = dishes.filter((m) => m.cat === cat);
        const first = items[0]!;
        const title = locale === 'bn' && first.cat_bn ? first.cat_bn : cat || otherLabel;
        return (
          <div key={cat} className="glass rounded-sheet p-4 sm:p-5">
            <h2 className="mb-2 text-lg font-bold">{title}</h2>
            <ul className="divide-y divide-line">
              {items.map((m) => (
                <li key={`${m.name}-${m.price_poisha}`} className="flex items-center gap-3 py-2.5">
                  {m.photo_path ? (
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-input">
                      <Image
                        src={dishPhotoUrl(m.photo_path)}
                        alt=""
                        fill
                        unoptimized
                        sizes="56px"
                        className="object-cover"
                      />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {locale === 'bn' && m.name_bn ? m.name_bn : m.name}
                    </span>
                    {m.description ? (
                      <span className="block truncate text-xs text-secondary">{m.description}</span>
                    ) : null}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatBDT(m.price_poisha, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
