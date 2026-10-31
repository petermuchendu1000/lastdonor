import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/dates';
import type { BlogPost } from '@/types';
import { blogCategoryLabel } from '@/lib/blog-categories';

type BlogCardProps = Pick<
  BlogPost,
  'slug' | 'title' | 'excerpt' | 'coverImageUrl' | 'authorName' | 'category' | 'publishedAt'
>;

export function BlogCard({
  slug,
  title,
  excerpt,
  coverImageUrl,
  authorName,
  category,
  publishedAt,
}: BlogCardProps) {
  return (
    <article className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <Link href={`/blog/${slug}`} className="block">
        {coverImageUrl && (
          <div className="relative aspect-video overflow-hidden">
            <Image
              src={coverImageUrl}
              alt={title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </div>
        )}
        <div className="p-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px]">
              {blogCategoryLabel(category)}
            </Badge>
            {publishedAt && (
              <span className="text-xs text-muted-foreground">
                {formatDate(publishedAt)}
              </span>
            )}
          </div>
          <h3 className="mt-2 line-clamp-2 font-display text-lg font-semibold leading-tight text-card-foreground">
            {title}
          </h3>
          {excerpt && (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {excerpt}
            </p>
          )}
          <p className="mt-3 text-xs font-medium text-muted-foreground">
            By {authorName}
          </p>
        </div>
      </Link>
    </article>
  );
}
