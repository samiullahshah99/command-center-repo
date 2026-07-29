'use client';

import { useAppForm, useFormFields } from '@/components/ui/tanstack-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createRoleProfileMutation, updateRoleProfileMutation } from '../api/mutations';
import type { RoleProfileRow } from '../api/types';
import {
  parseQuotaConfig,
  roleProfileFormSchema,
  type RoleProfileFormValues
} from '../schemas/role-profile';
import { TagsField } from './tags-field';

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export default function RoleProfileForm({
  initialData,
  pageTitle
}: {
  initialData: RoleProfileRow | null;
  pageTitle: string;
}) {
  const router = useRouter();
  const isEdit = !!initialData;

  const createMutation = useMutation({
    ...createRoleProfileMutation,
    onSuccess: () => {
      toast.success('Role profile created successfully');
      router.push('/dashboard/role-profiles');
    },
    onError: () => toast.error('Failed to create role profile')
  });

  const updateMutation = useMutation({
    ...updateRoleProfileMutation,
    onSuccess: () => {
      toast.success('Role profile updated successfully');
      router.push('/dashboard/role-profiles');
    },
    onError: () => toast.error('Failed to update role profile')
  });

  const form = useAppForm({
    defaultValues: {
      name: initialData?.name ?? '',
      trackedSignals: asStringArray(initialData?.trackedSignals),
      sourceChannels: asStringArray(initialData?.sourceChannels),
      // Pretty-printed so an existing config is readable in the textarea.
      quotaConfig: initialData ? JSON.stringify(initialData.quotaConfig ?? {}, null, 2) : '{}'
    } as RoleProfileFormValues,
    validators: {
      onSubmit: roleProfileFormSchema
    },
    onSubmit: ({ value }) => {
      const payload = {
        name: value.name.trim(),
        trackedSignals: value.trackedSignals,
        sourceChannels: value.sourceChannels,
        quotaConfig: parseQuotaConfig(value.quotaConfig)
      };

      if (isEdit) {
        updateMutation.mutate({ id: initialData.id, values: payload });
      } else {
        createMutation.mutate(payload);
      }
    }
  });

  const { FormTextField, FormTextareaField } = useFormFields<RoleProfileFormValues>();

  return (
    <Card className='mx-auto w-full'>
      <CardHeader>
        <CardTitle className='text-left text-2xl font-bold'>{pageTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form.Form className='space-y-8'>
            <FormTextField
              name='name'
              label='Profile Name'
              required
              placeholder='e.g. Creative strategist'
            />

            {/* string[] columns get a tag editor via the AppField escape hatch,
                since the shared form kit has no array field. */}
            <form.AppField name='trackedSignals'>
              {(field) => (
                <TagsField
                  label='Tracked Signals'
                  description='What we monitor for this role, e.g. ticket_volume, resolutions.'
                  placeholder='Add a signal and press Enter'
                  value={field.state.value as string[]}
                  onChange={(next) => field.handleChange(next)}
                />
              )}
            </form.AppField>

            <form.AppField name='sourceChannels'>
              {(field) => (
                <TagsField
                  label='Source Channels'
                  description='Where this role’s work shows up, e.g. slack, zendesk, brief_tracker.'
                  placeholder='Add a channel and press Enter'
                  value={field.state.value as string[]}
                  onChange={(next) => field.handleChange(next)}
                />
              )}
            </form.AppField>

            {/* Raw JSON, deliberately: quota_config's shape is not defined in the
                PRD, so a structured editor would invent one. */}
            <FormTextareaField
              name='quotaConfig'
              label='Quota Config (JSON)'
              rows={6}
              placeholder='{"briefs_per_week": 5}'
              description='A JSON object. Leave as {} until a real quota is agreed — an invented number would silently become a monitor threshold.'
            />

            <div className='flex justify-end gap-2'>
              <Button type='button' variant='outline' onClick={() => router.back()}>
                Back
              </Button>
              <form.SubmitButton>
                {isEdit ? 'Update Role Profile' : 'Add Role Profile'}
              </form.SubmitButton>
            </div>
          </form.Form>
        </form.AppForm>
      </CardContent>
    </Card>
  );
}
