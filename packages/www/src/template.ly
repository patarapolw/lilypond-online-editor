\version "2.22.1"

\header {
  title = "Untitled"
  composer = "Unknown"
}

\score {
  <<
  \new ChordNames \with {midiInstrument = "acoustic guitar (nylon)"} {
    \chordmode {
      
    }
  }

  \new Voice = "one" \relative ef' {
    \tempo 4 = 80
    \key c \major
    \clef 	treble
    
  }

  \new Lyrics \lyricsto "one" {
    
  }
  >>

  \layout {}
  \midi {}
}