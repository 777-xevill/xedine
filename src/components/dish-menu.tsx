import { UtensilsCrossed } from 'lucide-react';
import { DishPhoto, MenuCategoryBar } from '@/components/table-menu';
import { formatMoney, type Locale } from '@/lib/i18n/format';
import { dishPhotoUrl, type MenuDish } from '@/modules/customers/member-card-view';

/**
 * The customer's menu with dish photos, by category (member card page). Server only: photo links come
 * from the public menu-photos bucket. ADR 0063: photos in rounded frames that fade in, and, with
 * `navLabel`, a sticky bar of the categories.
 */
export function DishMenu({
  currency,
  dishes,
  locale,
  otherLabel,
  navLabel,
}: {
  currency: string;
  dishes: MenuDish[];
  locale: Locale;
  /** The heading for dishes with no category. */
  otherLabel: string;
  /** Names the categories bar for screen readers; without it there is no bar. */
  navLabel?: string;
}) {
  const categories = [...new Set(dishes.map((m) => m.cat))];
  const title = (cat: string) => {
    const first = dishes.find((m) => m.cat === cat)!;
    return locale === 'bn' && first.cat_bn ? first.cat_bn : cat || otherLabel;
  };
  return (
    <>
      {navLabel ? (
        <MenuCategoryBar
          label={navLabel}
          items={categories.map((cat, i) => ({ id: `dish-cat-${i}`, title: title(cat) }))}
        />
      ) : null}
      {categories.map((cat, i) => {
        const items = dishes.filter((m) => m.cat === cat);
        return (
          <section key={cat} id={`dish-cat-${i}`} className="cust-cat">
            <h2 className="cust-cat-title">{title(cat)}</h2>
            <ul className="cust-card cust-list">
              {items.map((m) => (
                <li key={`${m.name}-${m.price_poisha}`}>
                  <div className="cust-dish">
                    <span className="cust-photo">
                      {m.photo_path ? (
                        <DishPhoto src={dishPhotoUrl(m.photo_path)} sizes="72px" />
                      ) : (
                        <UtensilsCrossed aria-hidden className="size-6" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug font-semibold">
                        {locale === 'bn' && m.name_bn ? m.name_bn : m.name}
                      </span>
                      {m.description ? (
                        <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] leading-snug text-muted">
                          {m.description}
                        </span>
                      ) : null}
                    </span>
                    <span className="cust-price shrink-0">
                      {formatMoney(m.price_poisha, locale, currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
