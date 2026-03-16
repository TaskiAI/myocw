export interface CurriculumCourseSeed {
  courseNumber: string;
  title: string;
  urlPath: string;
}

export interface CurriculumTrackSeed {
  id: string;
  name: string;
  description: string;
  sourceUrl: string;
  sourceCollectionId: string;
  capturedAt: string;
  courses: CurriculumCourseSeed[];
}

export const CURRICULA_TRACKS: CurriculumTrackSeed[] = [
  {
    id: "ocw-scholar",
    name: "OCW Scholar Track",
    description:
      "MIT OCW Scholar courses are curated introductions for independent learners. Follow this sequence as a broad STEM foundation.",
    sourceUrl: "https://ocw.mit.edu/course-lists/scholar-courses/",
    sourceCollectionId: "2b404bc3-dd20-4e8c-b4c2-bc70f9d4a838",
    capturedAt: "2026-03-01",
    courses: [
      {
        courseNumber: "18.01SC",
        title: "Single Variable Calculus",
        urlPath: "/courses/18-01sc-single-variable-calculus-fall-2010",
      },
      {
        courseNumber: "18.02SC",
        title: "Multivariable Calculus",
        urlPath: "/courses/18-02sc-multivariable-calculus-fall-2010",
      },
      {
        courseNumber: "18.03SC",
        title: "Differential Equations",
        urlPath: "/courses/18-03sc-differential-equations-fall-2011",
      },
      {
        courseNumber: "18.06SC",
        title: "Linear Algebra",
        urlPath: "/courses/18-06sc-linear-algebra-fall-2011",
      },
      {
        courseNumber: "8.01SC",
        title: "Classical Mechanics",
        urlPath: "/courses/8-01sc-classical-mechanics-fall-2016",
      },
      {
        courseNumber: "8.03SC",
        title: "Physics III: Vibrations and Waves",
        urlPath: "/courses/8-03sc-physics-iii-vibrations-and-waves-fall-2016",
      },
      {
        courseNumber: "7.01SC",
        title: "Fundamentals of Biology",
        urlPath: "/courses/7-01sc-fundamentals-of-biology-fall-2011",
      },
      {
        courseNumber: "5.111SC",
        title: "Principles of Chemical Science",
        urlPath: "/courses/5-111sc-principles-of-chemical-science-fall-2014",
      },
      {
        courseNumber: "3.091SC",
        title: "Introduction to Solid State Chemistry",
        urlPath: "/courses/3-091sc-introduction-to-solid-state-chemistry-fall-2010",
      },
      {
        courseNumber: "6.00SC",
        title: "Introduction to Computer Science and Programming",
        urlPath:
          "/courses/6-00sc-introduction-to-computer-science-and-programming-spring-2011",
      },
      {
        courseNumber: "6.01SC",
        title: "Introduction to Electrical Engineering and Computer Science I",
        urlPath:
          "/courses/6-01sc-introduction-to-electrical-engineering-and-computer-science-i-spring-2011",
      },
      {
        courseNumber: "6.041SC",
        title: "Probabilistic Systems Analysis and Applied Probability",
        urlPath:
          "/courses/6-041sc-probabilistic-systems-analysis-and-applied-probability-fall-2013",
      },
      {
        courseNumber: "2.003SC",
        title: "Engineering Dynamics",
        urlPath: "/courses/2-003sc-engineering-dynamics-fall-2011",
      },
      {
        courseNumber: "9.00SC",
        title: "Introduction to Psychology",
        urlPath: "/courses/9-00sc-introduction-to-psychology-fall-2011",
      },
      {
        courseNumber: "14.01SC",
        title: "Principles of Microeconomics",
        urlPath: "/courses/14-01sc-principles-of-microeconomics-fall-2011",
      },
    ],
  },
  {
    id: "most-popular",
    name: "Most Popular Courses",
    description:
      "MIT OCW's most popular courses, arranged in MIT's published order. Use this as a demand-tested exploration path.",
    sourceUrl: "https://ocw.mit.edu/course-lists/most-popular-courses/",
    sourceCollectionId: "dc4305e7-4273-4e3a-905d-f2f7ce04bb21",
    capturedAt: "2026-03-01",
    courses: [
      {
        courseNumber: "6.0001",
        title: "Introduction to Computer Science and Programming in Python",
        urlPath:
          "/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016",
      },
      {
        courseNumber: "18.06SC",
        title: "Linear Algebra",
        urlPath: "/courses/18-06sc-linear-algebra-fall-2011",
      },
      {
        courseNumber: "18.01SC",
        title: "Single Variable Calculus",
        urlPath: "/courses/18-01sc-single-variable-calculus-fall-2010",
      },
      {
        courseNumber: "18.02SC",
        title: "Multivariable Calculus",
        urlPath: "/courses/18-02sc-multivariable-calculus-fall-2010",
      },
      {
        courseNumber: "6.006",
        title: "Introduction to Algorithms",
        urlPath: "/courses/6-006-introduction-to-algorithms-spring-2020",
      },
      {
        courseNumber: "8.01SC",
        title: "Classical Mechanics",
        urlPath: "/courses/8-01sc-classical-mechanics-fall-2016",
      },
      {
        courseNumber: "6.042J",
        title: "Mathematics for Computer Science",
        urlPath:
          "/courses/6-042j-mathematics-for-computer-science-fall-2010",
      },
      {
        courseNumber: "8.04",
        title: "Quantum Physics I",
        urlPath: "/courses/8-04-quantum-physics-i-spring-2016",
      },
      {
        courseNumber: "6.0002",
        title: "Introduction to Computational Thinking and Data Science",
        urlPath:
          "/courses/6-0002-introduction-to-computational-thinking-and-data-science-fall-2016",
      },
      {
        courseNumber: "18.S096",
        title: "Topics in Mathematics with Applications in Finance",
        urlPath:
          "/courses/18-s096-topics-in-mathematics-with-applications-in-finance-fall-2013",
      },
      {
        courseNumber: "RES.6-012",
        title: "Introduction to Probability",
        urlPath: "/courses/res-6-012-introduction-to-probability-spring-2018",
      },
      {
        courseNumber: "RES.6-007",
        title: "Signals and Systems",
        urlPath: "/courses/res-6-007-signals-and-systems-spring-2011",
      },
      {
        courseNumber: "18.03SC",
        title: "Differential Equations",
        urlPath: "/courses/18-03sc-differential-equations-fall-2011",
      },
      {
        courseNumber: "15.401",
        title: "Finance Theory I",
        urlPath: "/courses/15-401-finance-theory-i-fall-2008",
      },
      {
        courseNumber: "6.002",
        title: "Circuits and Electronics",
        urlPath: "/courses/6-002-circuits-and-electronics-spring-2007",
      },
      {
        courseNumber: "6.034",
        title: "Artificial Intelligence",
        urlPath: "/courses/6-034-artificial-intelligence-fall-2010",
      },
      {
        courseNumber: "15.S12",
        title: "Blockchain and Money",
        urlPath: "/courses/15-s12-blockchain-and-money-fall-2018",
      },
    ],
  },
];
