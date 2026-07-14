import type { Meta, StoryObj } from '@storybook/angular-vite';
import { ThemeSwitcher } from './theme-switcher';

const meta: Meta<ThemeSwitcher> = {
  title: 'Components/ThemeSwitcher',
  component: ThemeSwitcher,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<ThemeSwitcher>;

export const Default: Story = {};
