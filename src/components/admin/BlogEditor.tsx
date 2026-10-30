'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createBlogPostSchema, type CreateBlogPostInput } from '@/lib/validators/blog';
import { generateSlug } from '@/lib/utils/slug';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { ImageUpload } from '@/components/admin/ImageUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'campaign_story', label: 'Campaign Story' },
  { value: 'impact_report', label: 'Impact Report' },
  { value: 'news', label: 'News' },
];

interface BlogEditorProps {
  mode: 'create' | 'edit';
  postId?: string;
  defaultValues?: Partial<CreateBlogPostInput>;
}

export function BlogEditor({ mode, postId, defaultValues }: BlogEditorProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateBlogPostInput>({
    resolver: zodResolver(createBlogPostSchema),
    defaultValues: {
      title: '',
      slug: '',
      bodyHtml: '',
      excerpt: '',
      coverImageUrl: '',
      authorName: '',
      authorBio: '',
      category: 'news',
      published: false,
      ...defaultValues,
    },
  });

  const coverImageUrl = watch('coverImageUrl');

  function handleTitleBlur() {
    const title = watch('title');
    const currentSlug = watch('slug');
    if (title && !currentSlug) {
      setValue('slug', generateSlug(title));
    }
  }

  function handleShowPreview() {
    const html = watch('bodyHtml');
    setPreviewHtml(sanitizeHtml(html));
  }

  async function onSubmit(data: CreateBlogPostInput) {
    setIsSubmitting(true);
    try {
      const url =
        mode === 'create'
          ? '/api/v1/admin/blog'
          : `/api/v1/admin/blog/${postId}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error?.message || 'Failed to save post');
        return;
      }

      toast.success(mode === 'create' ? 'Blog post created!' : 'Blog post updated!');
      router.push('/admin/blog');
      router.refresh();
    } catch {
      toast.error('Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left column */}
        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              {...register('title')}
              onBlur={handleTitleBlur}
              placeholder="Enter blog post title"
            />
            {errors.title && <p className="mt-1 text-sm text-destructive">{errors.title.message}</p>}
          </div>

          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" {...register('slug')} placeholder="auto-generated-from-title" />
            {errors.slug && <p className="mt-1 text-sm text-destructive">{errors.slug.message}</p>}
          </div>

          <div>
            <Label htmlFor="category">Category</Label>
            <Select
              defaultValue={defaultValues?.category ?? 'news'}
              onValueChange={(v) => setValue('category', v as CreateBlogPostInput['category'])}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.category && <p className="mt-1 text-sm text-destructive">{errors.category.message}</p>}
          </div>

          <div>
            <Label htmlFor="authorName">Author Name</Label>
            <Input id="authorName" {...register('authorName')} placeholder="Author name" />
            {errors.authorName && <p className="mt-1 text-sm text-destructive">{errors.authorName.message}</p>}
          </div>

          <div>
            <Label htmlFor="authorBio">Author Bio</Label>
            <Textarea id="authorBio" {...register('authorBio')} placeholder="Short author bio" rows={2} />
          </div>

          <div>
            <Label htmlFor="excerpt">Excerpt</Label>
            <Textarea id="excerpt" {...register('excerpt')} placeholder="Brief summary for listings" rows={2} />
          </div>

          <div>
            <ImageUpload
              value={coverImageUrl ?? ''}
              onChange={(url) => setValue('coverImageUrl', url, { shouldValidate: true })}
              folder="blog"
              label="Cover Image"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="published"
              {...register('published')}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="published">Publish immediately</Label>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
        </div>
      </div>

      {/* Body HTML - full width */}
      <div>
        <Label>Body HTML</Label>
        <Tabs defaultValue="edit" onValueChange={(v) => v === 'preview' && handleShowPreview()}>
          <TabsList>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <Textarea
              {...register('bodyHtml')}
              placeholder="<p>Write your post content in HTML...</p>"
              rows={16}
              className="font-mono text-sm"
            />
            {errors.bodyHtml && <p className="mt-1 text-sm text-destructive">{errors.bodyHtml.message}</p>}
          </TabsContent>
          <TabsContent value="preview">
            <div className="prose dark:prose-invert max-w-none rounded-lg border p-4">
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Post' : 'Update Post'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/blog')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
