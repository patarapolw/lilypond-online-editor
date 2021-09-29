\version "2.22.1"

\header {
  title = "Untitled"
  composer = "Unknown"
}

\score {
  <<
  \new ChordNames {
    \chordmode {
      
    }
  }

  \new Voice = "one" \relative c' {
    \tempo 4 = 80
    \key c \major
    \clef treble
    
  }

  \new Lyrics \lyricsto "one" {
    
  }
  >>

  \layout {}
  \midi {}
}