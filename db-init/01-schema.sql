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
    chord_name VARCHAR(20)  NOT NULL,
    variant    TINYINT      DEFAULT 1,
    frets      VARCHAR(40)  NOT NULL,
    fingers    VARCHAR(40)  DEFAULT NULL,
    barre_fret TINYINT      DEFAULT NULL,
    UNIQUE KEY unique_shape (chord_name, variant)
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


INSERT IGNORE INTO chord_library (chord_name, variant, frets, fingers, barre_fret) VALUES
('C',   1, '-1,3,2,0,1,0',  '0,3,2,0,1,0', NULL),
('D',   1, '-1,-1,0,2,3,2', '0,0,0,1,3,2', NULL),
('Dm',  1, '-1,-1,0,2,3,1', '0,0,0,2,3,1', NULL),
('E',   1, '0,2,2,1,0,0',   '0,2,3,1,0,0', NULL),
('Em',  1, '0,2,2,0,0,0',   '0,2,3,0,0,0', NULL),
('F',   1, '1,3,3,2,1,1',   '1,3,4,2,1,1', 1),
('G',   1, '3,2,0,0,0,3',   '3,2,0,0,0,4', NULL),
('A',   1, '-1,0,2,2,2,0',  '0,0,1,2,3,0', NULL),
('Am',  1, '-1,0,2,2,1,0',  '0,0,2,3,1,0', NULL),
('B7',  1, '-1,2,1,2,0,2',  '0,2,1,3,0,4', NULL),
('Bm',  1, '-1,2,4,4,3,2',  '0,1,3,4,2,1', 2),
('F#m', 1, '2,4,4,2,2,2',   '1,3,4,1,1,1', 2),
('C7',  1, '-1,3,2,3,1,0',  '0,3,2,4,1,0', NULL),
('D7',  1, '-1,-1,0,2,1,2', '0,0,0,2,1,3', NULL),
('E7',  1, '0,2,0,1,0,0',   '0,2,0,1,0,0', NULL),
('G7',  1, '3,2,0,0,0,1',   '3,2,0,0,0,1', NULL),
('A7',  1, '-1,0,2,0,2,0',  '0,0,2,0,3,0', NULL),
('Cmaj7', 1, '-1,3,2,0,0,0','0,3,2,0,0,0', NULL),
('Dmaj7', 1, '-1,-1,0,2,2,2','0,0,0,1,1,1', NULL),
('Am7', 1, '-1,0,2,0,1,0',  '0,0,2,0,1,0', NULL),
('Em7', 1, '0,2,0,0,0,0',   '0,2,0,0,0,0', NULL),
('Dsus2', 1, '-1,-1,0,2,3,0','0,0,0,1,2,0', NULL),
('Dsus4', 1, '-1,-1,0,2,3,3','0,0,0,1,2,3', NULL),
('Asus2', 1, '-1,0,2,2,0,0','0,0,1,2,0,0', NULL),
('Asus4', 1, '-1,0,2,2,3,0','0,0,1,2,3,0', NULL),
('Cadd9', 1, '-1,3,2,0,3,0','0,2,1,0,3,0', NULL),
('E5',  1, '0,2,2,-1,-1,-1','0,1,2,0,0,0', NULL),
('A5',  1, '-1,0,2,2,-1,-1','0,0,1,2,0,0', NULL),
('D5',  1, '-1,-1,0,2,3,-1','0,0,0,1,3,0', NULL);


INSERT IGNORE INTO tags (name) VALUES
('classic-rock'), ('blues'), ('folk'), ('acoustic'),
('fingerpicking'), ('beginner'), ('strumming'), ('pop');


-- old migration code
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
