CREATE TABLE user_hospitals (
  sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
  hospital TEXT NOT NULL CHECK (hospital IN ('A','B','C')),
  PRIMARY KEY (sub,hospital)
);
INSERT INTO user_hospitals(sub,hospital)
SELECT sub,hospital FROM users WHERE hospital IN ('A','B','C');
