import { cva, type VariantProps } from 'class-variance-authority';

export const cardVariants = cva(
  'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-lg border bg-card py-(--card-spacing) text-sm text-card-foreground shadow-soft [--card-spacing:--spacing(5)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
  {
    variants: {
      zSize: {
        default: '',
        sm: '',
      },
    },
  },
);

export type ZardCardSizeType = NonNullable<VariantProps<typeof cardVariants>['zSize']>;

export const cardHeaderVariants = cva(
  'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-lg px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [&.border-b]:pb-(--card-spacing)',
);

export const cardTitleVariants = cva('text-base/snug font-bold tracking-[-0.015em] group-data-[size=sm]/card:text-sm');

export const cardDescriptionVariants = cva('text-sm text-muted-foreground');

export const cardActionVariants = cva('col-start-2 row-span-2 row-start-1 self-start justify-self-end');

export const cardContentVariants = cva('px-(--card-spacing)');

export const cardFooterVariants = cva('flex items-center rounded-b-lg bg-background p-(--card-spacing)');
