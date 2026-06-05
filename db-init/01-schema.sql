-- ASCII Chords — schema + seed data
-- Auto-loaded by mysql:8.0 entrypoint when the data volume is empty.

CREATE DATABASE IF NOT EXISTS ascii_chords_db
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ascii_chords_db;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Songs
CREATE TABLE IF NOT EXISTS songs (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT          NOT NULL,
    title        VARCHAR(150) NOT NULL,
    artist       VARCHAR(150) DEFAULT 'Unknown Artist',
    album        VARCHAR(150) DEFAULT NULL,
    year         SMALLINT     DEFAULT NULL,
    original_key VARCHAR(10)  DEFAULT 'C',
    capo         TINYINT      DEFAULT 0,
    tuning       VARCHAR(30)  DEFAULT 'Standard',
    tempo_bpm    SMALLINT     DEFAULT 120,
    difficulty   ENUM('Beginner','Intermediate','Advanced') DEFAULT 'Intermediate',
    genre        VARCHAR(60)  DEFAULT NULL,
    strumming    VARCHAR(100) DEFAULT NULL,
    notes        TEXT         DEFAULT NULL,
    body         LONGTEXT     NOT NULL,
    is_public    TINYINT(1)   NOT NULL DEFAULT 0,
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_is_public (is_public)
) ENGINE=InnoDB;

-- 3. Chord library
CREATE TABLE IF NOT EXISTS chord_library (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          DEFAULT NULL,
    chord_name VARCHAR(20)  NOT NULL,
    variant    TINYINT      DEFAULT 1,
    frets      VARCHAR(40)  NOT NULL,
    fingers    VARCHAR(40)  DEFAULT NULL,
    barre_fret TINYINT      DEFAULT NULL,
    UNIQUE KEY unique_shape (user_id, chord_name, variant),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. Tags
CREATE TABLE IF NOT EXISTS tags (
    id   INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- 5. Song <-> Tag junction
CREATE TABLE IF NOT EXISTS song_tags (
    song_id INT NOT NULL,
    tag_id  INT NOT NULL,
    PRIMARY KEY (song_id, tag_id),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Seed: built-in chord shapes (user_id NULL = global, available to everyone)
-- frets / fingers stored low-to-high: E A D G B e
-- (the renderer flips order if it expects high-to-low)
-- -1 = muted, 0 = open
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO chord_library (user_id, chord_name, variant, frets, fingers, barre_fret) VALUES
(NULL, 'C',   1, '-1,3,2,0,1,0',  '0,3,2,0,1,0', NULL),
(NULL, 'D',   1, '-1,-1,0,2,3,2', '0,0,0,1,3,2', NULL),
(NULL, 'Dm',  1, '-1,-1,0,2,3,1', '0,0,0,2,3,1', NULL),
(NULL, 'E',   1, '0,2,2,1,0,0',   '0,2,3,1,0,0', NULL),
(NULL, 'Em',  1, '0,2,2,0,0,0',   '0,2,3,0,0,0', NULL),
(NULL, 'F',   1, '1,3,3,2,1,1',   '1,3,4,2,1,1', 1),
(NULL, 'G',   1, '3,2,0,0,0,3',   '3,2,0,0,0,4', NULL),
(NULL, 'A',   1, '-1,0,2,2,2,0',  '0,0,1,2,3,0', NULL),
(NULL, 'Am',  1, '-1,0,2,2,1,0',  '0,0,2,3,1,0', NULL),
(NULL, 'B7',  1, '-1,2,1,2,0,2',  '0,2,1,3,0,4', NULL),
(NULL, 'Bm',  1, '-1,2,4,4,3,2',  '0,1,3,4,2,1', 2),
(NULL, 'F#m', 1, '2,4,4,2,2,2',   '1,3,4,1,1,1', 2),
(NULL, 'C7',  1, '-1,3,2,3,1,0',  '0,3,2,4,1,0', NULL),
(NULL, 'D7',  1, '-1,-1,0,2,1,2', '0,0,0,2,1,3', NULL),
(NULL, 'E7',  1, '0,2,0,1,0,0',   '0,2,0,1,0,0', NULL),
(NULL, 'G7',  1, '3,2,0,0,0,1',   '3,2,0,0,0,1', NULL),
(NULL, 'A7',  1, '-1,0,2,0,2,0',  '0,0,2,0,3,0', NULL),
(NULL, 'Cmaj7', 1, '-1,3,2,0,0,0','0,3,2,0,0,0', NULL),
(NULL, 'Dmaj7', 1, '-1,-1,0,2,2,2','0,0,0,1,1,1', NULL),
(NULL, 'Am7', 1, '-1,0,2,0,1,0',  '0,0,2,0,1,0', NULL),
(NULL, 'Em7', 1, '0,2,0,0,0,0',   '0,2,0,0,0,0', NULL),
(NULL, 'Dsus2', 1, '-1,-1,0,2,3,0','0,0,0,1,2,0', NULL),
(NULL, 'Dsus4', 1, '-1,-1,0,2,3,3','0,0,0,1,2,3', NULL),
(NULL, 'Asus2', 1, '-1,0,2,2,0,0','0,0,1,2,0,0', NULL),
(NULL, 'Asus4', 1, '-1,0,2,2,3,0','0,0,1,2,3,0', NULL),
(NULL, 'Cadd9', 1, '-1,3,2,0,3,0','0,2,1,0,3,0', NULL),
(NULL, 'E5',  1, '0,2,2,-1,-1,-1','0,1,2,0,0,0', NULL),
(NULL, 'A5',  1, '-1,0,2,2,-1,-1','0,0,1,2,0,0', NULL),
(NULL, 'D5',  1, '-1,-1,0,2,3,-1','0,0,0,1,3,0', NULL);

-- A handful of common tags
INSERT IGNORE INTO tags (name) VALUES
('classic-rock'), ('blues'), ('folk'), ('acoustic'),
('fingerpicking'), ('beginner'), ('strumming'), ('pop');

-- ---------------------------------------------------------------------------
-- Idempotent migration for installs created before is_public was introduced.
-- Wrapped in a procedure so it is safe to run on a brand-new schema too:
-- INFORMATION_SCHEMA tells us whether the column already exists.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS add_is_public_if_missing;
DELIMITER //
CREATE PROCEDURE add_is_public_if_missing()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'ascii_chords_db'
          AND TABLE_NAME   = 'songs'
          AND COLUMN_NAME  = 'is_public'
    ) THEN
        ALTER TABLE songs ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0;
        ALTER TABLE songs ADD INDEX idx_is_public (is_public);
    END IF;
END //
DELIMITER ;
CALL add_is_public_if_missing();
DROP PROCEDURE add_is_public_if_missing;
