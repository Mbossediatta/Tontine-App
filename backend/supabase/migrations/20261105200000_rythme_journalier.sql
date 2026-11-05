-- Rythme de cotisation journalier (en plus d'hebdomadaire, quinzaine et mensuel).
-- Seul dans sa migration : une valeur ajoutée à un type ne peut pas servir dans la même
-- transaction (voir …_duree_tour.sql).

alter type public.frequency add value if not exists 'daily' before 'weekly';
