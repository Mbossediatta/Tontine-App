export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_compensations: {
        Row: {
          admin_id: string;
          amount: number;
          at: string;
          group_id: string;
          id: string;
          note: string;
          paid_by: string;
        };
        ComputedFields: never;
        Insert: {
          admin_id: string;
          amount: number;
          at?: string;
          group_id: string;
          id?: string;
          note?: string;
          paid_by: string;
        };
        Update: {
          admin_id?: string;
          amount?: number;
          at?: string;
          group_id?: string;
          id?: string;
          note?: string;
          paid_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_compensations_admin_id_fkey';
            columns: ['admin_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'admin_compensations_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'admin_compensations_paid_by_fkey';
            columns: ['paid_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_log: {
        Row: {
          action: Database['public']['Enums']['audit_action'];
          actor_id: string | null;
          at: string;
          group_id: string | null;
          id: string;
          summary: string;
        };
        ComputedFields: never;
        Insert: {
          action: Database['public']['Enums']['audit_action'];
          actor_id?: string | null;
          at?: string;
          group_id?: string | null;
          id?: string;
          summary: string;
        };
        Update: {
          action?: Database['public']['Enums']['audit_action'];
          actor_id?: string | null;
          at?: string;
          group_id?: string | null;
          id?: string;
          summary?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      communities: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      community_admins: {
        Row: {
          admin_id: string;
          community_id: string;
          created_at: string;
        };
        ComputedFields: never;
        Insert: {
          admin_id: string;
          community_id: string;
          created_at?: string;
        };
        Update: {
          admin_id?: string;
          community_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'community_admins_admin_id_fkey';
            columns: ['admin_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'community_admins_community_id_fkey';
            columns: ['community_id'];
            isOneToOne: false;
            referencedRelation: 'communities';
            referencedColumns: ['id'];
          },
        ];
      };
      debts: {
        Row: {
          amount: number;
          created_at: string;
          group_id: string;
          id: string;
          penalty_amount: number;
          round_id: string;
          settled_at: string | null;
          settled_by: string | null;
          settled_round_id: string | null;
          settled_via: Database['public']['Enums']['debt_settlement'] | null;
          status: Database['public']['Enums']['debt_status'];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          group_id: string;
          id?: string;
          penalty_amount?: number;
          round_id: string;
          settled_at?: string | null;
          settled_by?: string | null;
          settled_round_id?: string | null;
          settled_via?: Database['public']['Enums']['debt_settlement'] | null;
          status?: Database['public']['Enums']['debt_status'];
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          group_id?: string;
          id?: string;
          penalty_amount?: number;
          round_id?: string;
          settled_at?: string | null;
          settled_by?: string | null;
          settled_round_id?: string | null;
          settled_via?: Database['public']['Enums']['debt_settlement'] | null;
          status?: Database['public']['Enums']['debt_status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'debts_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'debts_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'debts_settled_by_fkey';
            columns: ['settled_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'debts_settled_round_id_fkey';
            columns: ['settled_round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'debts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      dispute_events: {
        Row: {
          actor_id: string | null;
          at: string;
          dispute_id: string;
          id: string;
          text: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          at?: string;
          dispute_id: string;
          id?: string;
          text: string;
        };
        Update: {
          actor_id?: string | null;
          at?: string;
          dispute_id?: string;
          id?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'dispute_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'dispute_events_dispute_id_fkey';
            columns: ['dispute_id'];
            isOneToOne: false;
            referencedRelation: 'disputes';
            referencedColumns: ['id'];
          },
        ];
      };
      disputes: {
        Row: {
          amount: number;
          created_at: string;
          description: string;
          group_id: string;
          id: string;
          kind: Database['public']['Enums']['dispute_kind'];
          method: Database['public']['Enums']['payment_method'] | null;
          payment_id: string | null;
          provider_ref: string | null;
          refund_amount: number | null;
          refund_validated_at: string | null;
          refund_validated_by: string | null;
          round_id: string | null;
          status: Database['public']['Enums']['dispute_status'];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          description: string;
          group_id: string;
          id?: string;
          kind: Database['public']['Enums']['dispute_kind'];
          method?: Database['public']['Enums']['payment_method'] | null;
          payment_id?: string | null;
          provider_ref?: string | null;
          refund_amount?: number | null;
          refund_validated_at?: string | null;
          refund_validated_by?: string | null;
          round_id?: string | null;
          status?: Database['public']['Enums']['dispute_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          description?: string;
          group_id?: string;
          id?: string;
          kind?: Database['public']['Enums']['dispute_kind'];
          method?: Database['public']['Enums']['payment_method'] | null;
          payment_id?: string | null;
          provider_ref?: string | null;
          refund_amount?: number | null;
          refund_validated_at?: string | null;
          refund_validated_by?: string | null;
          round_id?: string | null;
          status?: Database['public']['Enums']['dispute_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'disputes_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disputes_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disputes_refund_validated_by_fkey';
            columns: ['refund_validated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disputes_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disputes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      groups: {
        Row: {
          admin_id: string;
          archived_at: string | null;
          attribution_mode: Database['public']['Enums']['attribution_mode'];
          community_id: string | null;
          contribution_amount: number;
          created_at: string;
          created_by: string;
          current_cycle: number;
          description: string | null;
          frequency: Database['public']['Enums']['frequency'];
          id: string;
          invite_code: string;
          join_policy: Database['public']['Enums']['join_policy'];
          late_penalty: number | null;
          max_members: number;
          member_status_visibility: Database['public']['Enums']['status_visibility'];
          membership_fee_amount: number;
          name: string;
          payment_due_day: number;
          payment_due_time: string;
          reserve_final_turn: boolean;
          shares_per_round: number;
          start_date: string;
          status: Database['public']['Enums']['group_status'];
          turn_length: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          admin_id: string;
          archived_at?: string | null;
          attribution_mode?: Database['public']['Enums']['attribution_mode'];
          community_id?: string | null;
          contribution_amount: number;
          created_at?: string;
          created_by: string;
          current_cycle?: number;
          description?: string | null;
          frequency: Database['public']['Enums']['frequency'];
          id?: string;
          invite_code: string;
          join_policy?: Database['public']['Enums']['join_policy'];
          late_penalty?: number | null;
          max_members: number;
          member_status_visibility?: Database['public']['Enums']['status_visibility'];
          membership_fee_amount?: number;
          name: string;
          payment_due_day: number;
          payment_due_time?: string;
          reserve_final_turn?: boolean;
          shares_per_round?: number;
          start_date: string;
          status?: Database['public']['Enums']['group_status'];
          turn_length?: number;
          updated_at?: string;
        };
        Update: {
          admin_id?: string;
          archived_at?: string | null;
          attribution_mode?: Database['public']['Enums']['attribution_mode'];
          community_id?: string | null;
          contribution_amount?: number;
          created_at?: string;
          created_by?: string;
          current_cycle?: number;
          description?: string | null;
          frequency?: Database['public']['Enums']['frequency'];
          id?: string;
          invite_code?: string;
          join_policy?: Database['public']['Enums']['join_policy'];
          late_penalty?: number | null;
          max_members?: number;
          member_status_visibility?: Database['public']['Enums']['status_visibility'];
          membership_fee_amount?: number;
          name?: string;
          payment_due_day?: number;
          payment_due_time?: string;
          reserve_final_turn?: boolean;
          shares_per_round?: number;
          start_date?: string;
          status?: Database['public']['Enums']['group_status'];
          turn_length?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'groups_admin_id_fkey';
            columns: ['admin_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'groups_community_id_fkey';
            columns: ['community_id'];
            isOneToOne: false;
            referencedRelation: 'communities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'groups_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      memberships: {
        Row: {
          group_id: string;
          id: string;
          joined_at: string;
          payout_order: number | null;
          role: Database['public']['Enums']['group_role'];
          status: Database['public']['Enums']['membership_status'];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          group_id: string;
          id?: string;
          joined_at?: string;
          payout_order?: number | null;
          role?: Database['public']['Enums']['group_role'];
          status?: Database['public']['Enums']['membership_status'];
          user_id: string;
        };
        Update: {
          group_id?: string;
          id?: string;
          joined_at?: string;
          payout_order?: number | null;
          role?: Database['public']['Enums']['group_role'];
          status?: Database['public']['Enums']['membership_status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'memberships_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          link: string | null;
          read: boolean;
          title: string;
          type: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          link?: string | null;
          read?: boolean;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          link?: string | null;
          read?: boolean;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_reminders: {
        Row: {
          day: string;
          id: string;
          round_id: string;
          sent_at: string;
          sent_by: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          day?: string;
          id?: string;
          round_id: string;
          sent_at?: string;
          sent_by?: string | null;
          user_id: string;
        };
        Update: {
          day?: string;
          id?: string;
          round_id?: string;
          sent_at?: string;
          sent_by?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_reminders_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_reminders_sent_by_fkey';
            columns: ['sent_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_reminders_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          contribution_amount: number;
          created_at: string;
          id: string;
          late_penalty_amount: number;
          membership_fee_amount: number;
          method: Database['public']['Enums']['payment_method'];
          paid_at: string | null;
          provider_ref: string | null;
          provider_token: string | null;
          recorded_by: string | null;
          round_id: string;
          service_fee_amount: number;
          status: Database['public']['Enums']['payment_status'];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          contribution_amount?: number;
          created_at?: string;
          id?: string;
          late_penalty_amount?: number;
          membership_fee_amount?: number;
          method: Database['public']['Enums']['payment_method'];
          paid_at?: string | null;
          provider_ref?: string | null;
          provider_token?: string | null;
          recorded_by?: string | null;
          round_id: string;
          service_fee_amount?: number;
          status?: Database['public']['Enums']['payment_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          contribution_amount?: number;
          created_at?: string;
          id?: string;
          late_penalty_amount?: number;
          membership_fee_amount?: number;
          method?: Database['public']['Enums']['payment_method'];
          paid_at?: string | null;
          provider_ref?: string | null;
          provider_token?: string | null;
          recorded_by?: string | null;
          round_id?: string;
          service_fee_amount?: number;
          status?: Database['public']['Enums']['payment_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payments_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      penalties: {
        Row: {
          amount: number;
          applied_at: string;
          id: string;
          round_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          applied_at?: string;
          id?: string;
          round_id: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          applied_at?: string;
          id?: string;
          round_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'penalties_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'penalties_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_earnings: {
        Row: {
          amount: number;
          at: string;
          group_id: string;
          id: string;
          kind: Database['public']['Enums']['earning_kind'];
          payment_id: string | null;
          round_id: string | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          at?: string;
          group_id: string;
          id?: string;
          kind: Database['public']['Enums']['earning_kind'];
          payment_id?: string | null;
          round_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: number;
          at?: string;
          group_id?: string;
          id?: string;
          kind?: Database['public']['Enums']['earning_kind'];
          payment_id?: string | null;
          round_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_earnings_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_earnings_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_earnings_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_earnings_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_settings: {
        Row: {
          app: NonNullable<Json>;
          id: boolean;
          payment: NonNullable<Json>;
          rules: NonNullable<Json>;
          security: NonNullable<Json>;
          sms: NonNullable<Json>;
          templates: NonNullable<Json>;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          app: NonNullable<Json>;
          id?: boolean;
          payment: NonNullable<Json>;
          rules: NonNullable<Json>;
          security: NonNullable<Json>;
          sms: NonNullable<Json>;
          templates: NonNullable<Json>;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          app?: NonNullable<Json>;
          id?: boolean;
          payment?: NonNullable<Json>;
          rules?: NonNullable<Json>;
          security?: NonNullable<Json>;
          sms?: NonNullable<Json>;
          templates?: NonNullable<Json>;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_settings_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          deleted_at: string | null;
          first_name: string;
          global_role: Database['public']['Enums']['global_role'];
          id: string;
          is_suspended: boolean;
          language: Database['public']['Enums']['app_language'];
          last_name: string;
          notification_prefs: NonNullable<Json>;
          payout_method: Database['public']['Enums']['payout_method'] | null;
          payout_phone: string | null;
          phone: string | null;
          terms_version: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          first_name: string;
          global_role?: Database['public']['Enums']['global_role'];
          id: string;
          is_suspended?: boolean;
          language?: Database['public']['Enums']['app_language'];
          last_name: string;
          notification_prefs?: NonNullable<Json>;
          payout_method?: Database['public']['Enums']['payout_method'] | null;
          payout_phone?: string | null;
          phone?: string | null;
          terms_version?: number | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          first_name?: string;
          global_role?: Database['public']['Enums']['global_role'];
          id?: string;
          is_suspended?: boolean;
          language?: Database['public']['Enums']['app_language'];
          last_name?: string;
          notification_prefs?: NonNullable<Json>;
          payout_method?: Database['public']['Enums']['payout_method'] | null;
          payout_phone?: string | null;
          phone?: string | null;
          terms_version?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      provider_ledger: {
        Row: {
          amount: number;
          at: string;
          created_at: string;
          payment_id: string | null;
          phone: string | null;
          ref: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          at: string;
          created_at?: string;
          payment_id?: string | null;
          phone?: string | null;
          ref: string;
        };
        Update: {
          amount?: number;
          at?: string;
          created_at?: string;
          payment_id?: string | null;
          phone?: string | null;
          ref?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'provider_ledger_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          p256dh: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      round_beneficiaries: {
        Row: {
          amount: number;
          membership_id: string;
          received_at: string | null;
          round_id: string;
          sent_at: string | null;
          sent_by: string | null;
          sent_method: Database['public']['Enums']['payout_method'] | null;
          sent_ref: string | null;
          withheld: number;
        };
        ComputedFields: never;
        Insert: {
          amount?: number;
          membership_id: string;
          received_at?: string | null;
          round_id: string;
          sent_at?: string | null;
          sent_by?: string | null;
          sent_method?: Database['public']['Enums']['payout_method'] | null;
          sent_ref?: string | null;
          withheld?: number;
        };
        Update: {
          amount?: number;
          membership_id?: string;
          received_at?: string | null;
          round_id?: string;
          sent_at?: string | null;
          sent_by?: string | null;
          sent_method?: Database['public']['Enums']['payout_method'] | null;
          sent_ref?: string | null;
          withheld?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'round_beneficiaries_membership_id_fkey';
            columns: ['membership_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'round_beneficiaries_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'round_beneficiaries_sent_by_fkey';
            columns: ['sent_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      rounds: {
        Row: {
          created_at: string;
          cycle: number;
          due_date: string;
          group_id: string;
          id: string;
          number: number;
          open_date: string;
          paid_out_at: string | null;
          payout_block_reason: string | null;
          payout_blocked_at: string | null;
          payout_validated_by: string | null;
          pot_amount: number;
          recipient_type: Database['public']['Enums']['recipient_type'];
          status: Database['public']['Enums']['round_status'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          cycle?: number;
          due_date: string;
          group_id: string;
          id?: string;
          number: number;
          open_date: string;
          paid_out_at?: string | null;
          payout_block_reason?: string | null;
          payout_blocked_at?: string | null;
          payout_validated_by?: string | null;
          pot_amount?: number;
          recipient_type?: Database['public']['Enums']['recipient_type'];
          status?: Database['public']['Enums']['round_status'];
        };
        Update: {
          created_at?: string;
          cycle?: number;
          due_date?: string;
          group_id?: string;
          id?: string;
          number?: number;
          open_date?: string;
          paid_out_at?: string | null;
          payout_block_reason?: string | null;
          payout_blocked_at?: string | null;
          payout_validated_by?: string | null;
          pot_amount?: number;
          recipient_type?: Database['public']['Enums']['recipient_type'];
          status?: Database['public']['Enums']['round_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'rounds_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rounds_payout_validated_by_fkey';
            columns: ['payout_validated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      security_events: {
        Row: {
          at: string;
          detail: string;
          id: string;
          ip: unknown;
          kind: Database['public']['Enums']['security_event_kind'];
          phone: string | null;
          severity: Database['public']['Enums']['security_severity'];
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          at?: string;
          detail: string;
          id?: string;
          ip?: unknown;
          kind: Database['public']['Enums']['security_event_kind'];
          phone?: string | null;
          severity?: Database['public']['Enums']['security_severity'];
          user_id?: string | null;
        };
        Update: {
          at?: string;
          detail?: string;
          id?: string;
          ip?: unknown;
          kind?: Database['public']['Enums']['security_event_kind'];
          phone?: string | null;
          severity?: Database['public']['Enums']['security_severity'];
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'security_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      sms_log: {
        Row: {
          at: string;
          cost: number;
          id: string;
          kind: Database['public']['Enums']['sms_kind'];
          phone: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          at?: string;
          cost?: number;
          id?: string;
          kind: Database['public']['Enums']['sms_kind'];
          phone: string;
          user_id?: string | null;
        };
        Update: {
          at?: string;
          cost?: number;
          id?: string;
          kind?: Database['public']['Enums']['sms_kind'];
          phone?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sms_log_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      swap_requests: {
        Row: {
          created_at: string;
          cycle: number;
          decided_at: string | null;
          group_id: string;
          id: string;
          partner_id: string;
          partner_membership_id: string;
          partner_round_id: string;
          requester_id: string;
          requester_membership_id: string;
          requester_round_id: string;
          status: Database['public']['Enums']['swap_status'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          cycle: number;
          decided_at?: string | null;
          group_id: string;
          id?: string;
          partner_id: string;
          partner_membership_id: string;
          partner_round_id: string;
          requester_id: string;
          requester_membership_id: string;
          requester_round_id: string;
          status?: Database['public']['Enums']['swap_status'];
        };
        Update: {
          created_at?: string;
          cycle?: number;
          decided_at?: string | null;
          group_id?: string;
          id?: string;
          partner_id?: string;
          partner_membership_id?: string;
          partner_round_id?: string;
          requester_id?: string;
          requester_membership_id?: string;
          requester_round_id?: string;
          status?: Database['public']['Enums']['swap_status'];
        };
        Relationships: [
          {
            foreignKeyName: 'swap_requests_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'swap_requests_partner_id_fkey';
            columns: ['partner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'swap_requests_partner_membership_id_fkey';
            columns: ['partner_membership_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'swap_requests_partner_round_id_fkey';
            columns: ['partner_round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'swap_requests_requester_id_fkey';
            columns: ['requester_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'swap_requests_requester_membership_id_fkey';
            columns: ['requester_membership_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'swap_requests_requester_round_id_fkey';
            columns: ['requester_round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['id'];
          },
        ];
      };
      terms_acceptances: {
        Row: {
          accepted_at: string;
          id: string;
          user_agent: string | null;
          user_id: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string;
          id?: string;
          user_agent?: string | null;
          user_id: string;
          version: number;
        };
        Update: {
          accepted_at?: string;
          id?: string;
          user_agent?: string | null;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'terms_acceptances_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_choices: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          name: string;
        }[];
      };
      admin_compensate: {
        Args: { p_amount: number; p_group: string; p_note: string };
        Returns: undefined;
      };
      admin_pin_pending: {
        Args: { p_users: string[] };
        Returns: {
          pin_pending: boolean;
          user_id: string;
        }[];
      };
      admin_reactivate: { Args: { p_user: string }; Returns: undefined };
      admin_reassign_groups: { Args: { p_from: string; p_to: string }; Returns: number };
      admin_revoke: { Args: { p_user: string }; Returns: undefined };
      admin_super_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
      admin_suspend: { Args: { p_user: string }; Returns: undefined };
      admin_update: {
        Args: { p_first_name: string; p_last_name: string; p_phone: string; p_user: string };
        Returns: undefined;
      };
      community_save: {
        Args: { p_admin_ids: string[]; p_description: string; p_id: string; p_name: string };
        Returns: string;
      };
      debt_record_payment: { Args: { p_debt: string }; Returns: undefined };
      dispute_open: {
        Args: {
          p_amount: number;
          p_description: string;
          p_group: string;
          p_kind: Database['public']['Enums']['dispute_kind'];
          p_method: Database['public']['Enums']['payment_method'];
          p_provider_ref: string;
          p_round: string;
        };
        Returns: string;
      };
      dispute_record_payment: { Args: { p_dispute: string }; Returns: undefined };
      dispute_refund: {
        Args: { p_amount: number; p_dispute: string; p_note: string };
        Returns: undefined;
      };
      dispute_reject: { Args: { p_dispute: string; p_note: string }; Returns: undefined };
      dispute_take: { Args: { p_dispute: string }; Returns: undefined };
      group_announce: { Args: { p_group: string; p_message: string }; Returns: number };
      group_archive: { Args: { p_group: string }; Returns: undefined };
      group_change_admin: { Args: { p_admin: string; p_group: string }; Returns: undefined };
      group_close: { Args: { p_group: string }; Returns: undefined };
      group_create: { Args: { p: Json }; Returns: string };
      group_join_preview: { Args: { p_code: string }; Returns: Json };
      group_order_view: { Args: { p_groups: string[] }; Returns: Json };
      group_reactivate: { Args: { p_group: string }; Returns: undefined };
      group_regenerate_invite: { Args: { p_group: string }; Returns: string };
      group_remove: { Args: { p_group: string }; Returns: undefined };
      group_request_join: { Args: { p_code: string }; Returns: undefined };
      group_request_join_open: { Args: { p_group: string }; Returns: undefined };
      group_restart_cycle: {
        Args: { p_group: string; p_keep_order: boolean; p_start_date: string };
        Returns: undefined;
      };
      group_round_statuses: { Args: { p_groups: string[] }; Returns: Json };
      group_set_due_time: { Args: { p_group: string; p_time: string }; Returns: undefined };
      group_start: { Args: { p_group: string }; Returns: undefined };
      group_suspend: { Args: { p_group: string }; Returns: undefined };
      group_transfer: {
        Args: { p_admin: string; p_community: string; p_group: string };
        Returns: undefined;
      };
      group_update: { Args: { p: Json; p_group: string }; Returns: undefined };
      groups_discoverable: {
        Args: Record<PropertyKey, never>;
        Returns: {
          admin_id: string;
          archived_at: string | null;
          attribution_mode: Database['public']['Enums']['attribution_mode'];
          community_id: string | null;
          contribution_amount: number;
          created_at: string;
          created_by: string;
          current_cycle: number;
          description: string | null;
          frequency: Database['public']['Enums']['frequency'];
          id: string;
          invite_code: string;
          join_policy: Database['public']['Enums']['join_policy'];
          late_penalty: number | null;
          max_members: number;
          member_status_visibility: Database['public']['Enums']['status_visibility'];
          membership_fee_amount: number;
          name: string;
          payment_due_day: number;
          payment_due_time: string;
          reserve_final_turn: boolean;
          shares_per_round: number;
          start_date: string;
          status: Database['public']['Enums']['group_status'];
          turn_length: number;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'groups';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      legal_terms: { Args: Record<PropertyKey, never>; Returns: Json };
      log_refusal: { Args: { p_hint: string }; Returns: undefined };
      member_block: { Args: { p_user: string }; Returns: undefined };
      member_unblock: { Args: { p_user: string }; Returns: undefined };
      membership_accept: { Args: { p_membership: string }; Returns: undefined };
      membership_add_by_phone: {
        Args: { p_group: string; p_phone: string; p_share_count?: number };
        Returns: number;
      };
      membership_reject: { Args: { p_membership: string }; Returns: undefined };
      membership_remove: { Args: { p_membership: string }; Returns: undefined };
      membership_set_role: {
        Args: { p_membership: string; p_role: Database['public']['Enums']['group_role'] };
        Returns: undefined;
      };
      order_draw: { Args: { p_group: string }; Returns: undefined };
      order_set: { Args: { p_group: string; p_memberships: string[] }; Returns: undefined };
      payment_receipt: { Args: { p_payment: string }; Returns: Json };
      payment_record_cash: {
        Args: { p_periods?: number; p_round: string; p_user: string };
        Returns: undefined;
      };
      payout_block: { Args: { p_reason: string; p_round: string }; Returns: undefined };
      payout_confirm_received: { Args: { p_round: string }; Returns: undefined };
      payout_mark_sent: {
        Args: {
          p_method: Database['public']['Enums']['payout_method'];
          p_ref: string;
          p_round: string;
          p_user: string;
        };
        Returns: undefined;
      };
      payout_unblock: { Args: { p_round: string }; Returns: undefined };
      platform_health: { Args: Record<PropertyKey, never>; Returns: Json };
      public_profiles: {
        Args: { ids: string[] };
        Returns: {
          avatar_url: string;
          first_name: string;
          id: string;
          last_name: string;
        }[];
      };
      public_settings: { Args: Record<PropertyKey, never>; Returns: Json };
      reminder_send: { Args: { p_round: string; p_user?: string }; Returns: number };
      round_payout: { Args: { p_round: string }; Returns: undefined };
      settings_get: { Args: Record<PropertyKey, never>; Returns: Json };
      settings_update: {
        Args: { p_new_secret?: string; p_section: string; p_values: Json };
        Returns: undefined;
      };
      svc_admin_create: {
        Args: {
          p_actor: string;
          p_first_name: string;
          p_last_name: string;
          p_phone: string;
          p_user: string;
        };
        Returns: string;
      };
      svc_announcement: {
        Args: {
          p_actor: string;
          p_group: string;
          p_kind: string;
          p_message: string;
          p_title: string;
        };
        Returns: Json;
      };
      svc_member_create: {
        Args: {
          p_actor: string;
          p_first_name: string;
          p_last_name: string;
          p_phone: string;
          p_user: string;
        };
        Returns: string;
      };
      svc_otp_check: { Args: { p_code_hash: string; p_phone: string }; Returns: string };
      svc_otp_issue: {
        Args: { p_code_hash: string; p_ip: unknown; p_phone: string; p_validity_minutes: number };
        Returns: string;
      };
      svc_payment_confirm: {
        Args: { p_charged: number; p_payment: string; p_phone: string; p_provider_ref: string };
        Returns: string;
      };
      svc_payment_fail: { Args: { p_payment: string }; Returns: string };
      svc_payment_owner: { Args: { p_payment: string }; Returns: string };
      svc_payment_prepare: {
        Args: {
          p_method: Database['public']['Enums']['payment_method'];
          p_periods?: number;
          p_round: string;
          p_user: string;
        };
        Returns: Json;
      };
      svc_payment_set_token: { Args: { p_payment: string; p_token: string }; Returns: undefined };
      svc_paytech_keys: { Args: Record<PropertyKey, never>; Returns: Json };
      svc_phone_change: {
        Args: { p_actor: string; p_phone: string; p_user: string };
        Returns: undefined;
      };
      svc_pin_begin_attempt: {
        Args: { p_max_attempts: number; p_user: string };
        Returns: {
          attempt: number;
          pin_hash: string;
        }[];
      };
      svc_pin_finish_attempt: {
        Args: { p_max_attempts: number; p_success: boolean; p_user: string };
        Returns: number;
      };
      svc_pin_require_reset: { Args: { p_user: string }; Returns: undefined };
      svc_pin_save: { Args: { p_pin_hash: string; p_user: string }; Returns: undefined };
      svc_pin_usable: { Args: { p_user: string }; Returns: boolean };
      svc_purge_auth_otps: { Args: Record<PropertyKey, never>; Returns: number };
      svc_recent_pin_failures: { Args: { p_ip: unknown }; Returns: number };
      svc_revoke_sessions: { Args: { p_user: string }; Returns: undefined };
      svc_terms_accept: {
        Args: { p_user: string; p_user_agent: string; p_version: number };
        Returns: undefined;
      };
      svc_terms_due: { Args: { p_user: string }; Returns: number };
      swap_cancel: { Args: { p_swap: string }; Returns: undefined };
      swap_decide: { Args: { p_approve: boolean; p_swap: string }; Returns: undefined };
      swap_request: {
        Args: { p_my_round: string; p_partner?: string; p_partner_round: string };
        Returns: string;
      };
      swap_respond: { Args: { p_accept: boolean; p_swap: string }; Returns: undefined };
      terms_accept: { Args: { p_user_agent?: string; p_version: number }; Returns: undefined };
      terms_status: { Args: Record<PropertyKey, never>; Returns: Json };
    };
    Enums: {
      app_language: 'fr' | 'wo';
      attribution_mode: 'random' | 'manual';
      audit_action:
        | 'group_created'
        | 'group_updated'
        | 'group_suspended'
        | 'group_reactivated'
        | 'payout_validated'
        | 'cash_recorded'
        | 'admin_added'
        | 'admin_suspended'
        | 'admin_reactivated'
        | 'admin_revoked'
        | 'settings_updated'
        | 'login'
        | 'group_closed'
        | 'group_archived'
        | 'group_admin_changed'
        | 'groups_reassigned'
        | 'admin_updated'
        | 'admin_deleted'
        | 'pin_reset'
        | 'member_blocked'
        | 'member_unblocked'
        | 'phone_changed'
        | 'member_created'
        | 'payout_blocked'
        | 'payout_unblocked'
        | 'dispute_updated'
        | 'refund_validated'
        | 'announcement_sent'
        | 'admin_compensated'
        | 'community_created'
        | 'community_updated'
        | 'group_community_changed'
        | 'reminder_sent'
        | 'swap_approved'
        | 'payout_sent';
      debt_settlement: 'cash' | 'withheld';
      debt_status: 'open' | 'settled';
      dispute_kind:
        | 'debited_not_recorded'
        | 'double_payment'
        | 'wrong_amount'
        | 'other'
        | 'payout_not_received';
      dispute_status: 'open' | 'in_progress' | 'resolved' | 'rejected';
      earning_kind: 'membership_fee' | 'late_penalty' | 'reserved_turn';
      frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
      global_role: 'super_admin' | 'admin' | 'user';
      group_role: 'owner' | 'co_admin' | 'member';
      group_status: 'draft' | 'active' | 'finished' | 'suspended';
      join_policy: 'invite' | 'community';
      membership_status: 'pending' | 'active' | 'removed';
      payment_method: 'wave' | 'orange_money' | 'free_money' | 'cash';
      payment_status: 'pending' | 'paid' | 'late' | 'failed' | 'refunded';
      payout_method: 'wave' | 'orange_money';
      recipient_type: 'members' | 'platform';
      round_status: 'upcoming' | 'open' | 'ready_for_payout' | 'paid_out';
      security_event_kind:
        | 'pin_failed'
        | 'pin_blocked'
        | 'otp_failed'
        | 'access_denied'
        | 'suspicious_input'
        | 'admin_login';
      security_severity: 'info' | 'warning' | 'critical';
      sms_kind: 'otp' | 'reminder' | 'announcement' | 'payment' | 'payout';
      status_visibility: 'members' | 'admins';
      swap_status: 'pending_partner' | 'pending_admin' | 'approved' | 'rejected' | 'cancelled';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_language: ['fr', 'wo'],
      attribution_mode: ['random', 'manual'],
      audit_action: [
        'group_created',
        'group_updated',
        'group_suspended',
        'group_reactivated',
        'payout_validated',
        'cash_recorded',
        'admin_added',
        'admin_suspended',
        'admin_reactivated',
        'admin_revoked',
        'settings_updated',
        'login',
        'group_closed',
        'group_archived',
        'group_admin_changed',
        'groups_reassigned',
        'admin_updated',
        'admin_deleted',
        'pin_reset',
        'member_blocked',
        'member_unblocked',
        'phone_changed',
        'member_created',
        'payout_blocked',
        'payout_unblocked',
        'dispute_updated',
        'refund_validated',
        'announcement_sent',
        'admin_compensated',
        'community_created',
        'community_updated',
        'group_community_changed',
        'reminder_sent',
        'swap_approved',
        'payout_sent',
      ],
      debt_settlement: ['cash', 'withheld'],
      debt_status: ['open', 'settled'],
      dispute_kind: [
        'debited_not_recorded',
        'double_payment',
        'wrong_amount',
        'other',
        'payout_not_received',
      ],
      dispute_status: ['open', 'in_progress', 'resolved', 'rejected'],
      earning_kind: ['membership_fee', 'late_penalty', 'reserved_turn'],
      frequency: ['daily', 'weekly', 'biweekly', 'monthly'],
      global_role: ['super_admin', 'admin', 'user'],
      group_role: ['owner', 'co_admin', 'member'],
      group_status: ['draft', 'active', 'finished', 'suspended'],
      join_policy: ['invite', 'community'],
      membership_status: ['pending', 'active', 'removed'],
      payment_method: ['wave', 'orange_money', 'free_money', 'cash'],
      payment_status: ['pending', 'paid', 'late', 'failed', 'refunded'],
      payout_method: ['wave', 'orange_money'],
      recipient_type: ['members', 'platform'],
      round_status: ['upcoming', 'open', 'ready_for_payout', 'paid_out'],
      security_event_kind: [
        'pin_failed',
        'pin_blocked',
        'otp_failed',
        'access_denied',
        'suspicious_input',
        'admin_login',
      ],
      security_severity: ['info', 'warning', 'critical'],
      sms_kind: ['otp', 'reminder', 'announcement', 'payment', 'payout'],
      status_visibility: ['members', 'admins'],
      swap_status: ['pending_partner', 'pending_admin', 'approved', 'rejected', 'cancelled'],
    },
  },
} as const;
